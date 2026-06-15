#!/usr/bin/env bash
# Run the chromium E2E suite in shards, each with a FRESH dev server.
#
# Why: `next dev` (Turbopack) leaks to ~12GB over a full ~1400-test run, which trips
# Next's built-in memory auto-restart mid-run -> in-flight requests hang -> flaky
# timeout failures. Raising --max-old-space-size only delays the restart (verified:
# 8GB->16GB cut fails 8-11 -> 3 but a restart still happened at 12GB). Sharding resets
# the dev server every shard, so RSS never reaches the threshold -> 0 restarts -> 0
# collateral failures. Stays in dev-mode (no prod rate-limit problem).
#
# Each shard is a SEPARATE `playwright test` invocation, so Playwright starts and tears
# down its own dev server per shard (the leak resets).
#
# TWO BUCKETS (see HEAVY_SPECS in playwright.config.ts):
#   chromium-heavy : ~17 route-dense specs (>=12 page.goto each). These dominate
#                    Turbopack route-compilation, so they get their own fresh servers
#                    instead of randomly clustering inside an alphabetical chromium
#                    shard (which is what pushed one shard to ~10GB before).
#   chromium       : the remaining ~107 lighter specs.
# Both buckets are sub-sharded so neither single dev server compiles too much at once;
# smaller shards genuinely lower the peak (the leak fills whatever heap it's given, so
# raising --max-old-space-size does NOT help -> peak just tracks the cap -> Next restarts).
#
# Usage: scripts/run-pw-sharded.sh [LIGHT_N] [HEAVY_N]   (defaults: 6 4 -> 10 server boots)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

RED=$'\033[1;31m'
DIM=$'\033[2m'
RESET=$'\033[0m'

LIGHT_N="${1:-6}"
HEAVY_N="${2:-4}"
FAILED=""
TOTAL_PASS=0
TOTAL_FAIL=0
ALL_ERRORS=""
ACTIVE_TMP=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  [ -z "$ACTIVE_TMP" ] || rm -f "$ACTIVE_TMP"
  bash scripts/kill-dev-server.sh 3777 >/dev/null 2>&1 || true
  exit "$status"
}

trap cleanup EXIT INT TERM

mkdir -p test-runs
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LOGFILE="test-runs/${TIMESTAMP}_${COMMIT}_sharded.log"

run_shards() {
  local project="$1" n="$2"
  [ "$n" -ge 1 ] 2>/dev/null || { echo "(skip $project: 0 shards)"; return 0; }
  for k in $(seq 1 "$n"); do
    echo ""
    echo "===================== $project shard $k/$n ====================="
    bash scripts/kill-dev-server.sh 3777 >/dev/null 2>&1 || true
    # Wipe Turbopack's persistent on-disk cache before each fresh server. Killing the
    # dev server between shards can interrupt Turbopack mid-write to .next/dev/cache,
    # leaving a dangling .meta -> missing .sst reference. The NEXT server then panics on
    # boot ("Failed to lookup task ids ... Failed to open SST file"), serves no pages,
    # and the whole shard fails. Starting each shard from a clean cache removes the class.
    rm -rf .next/dev/cache 2>/dev/null
    local _tmp; _tmp=$(mktemp); ACTIVE_TMP="$_tmp"
    FORCE_COLOR=0 npx playwright test --project="$project" --shard="$k/$n" --reporter=list 2>&1 | tee "$_tmp" | grep --line-buffered -E '^\s*[✓✘]' | awk -v red="$RED" -v dim="$DIM" -v reset="$RESET" \
      '/✘/ {printf "%s%s%s\n", red, $0, reset; fflush(); next}
       /✓/ {printf "%s%s%s\n", dim, $0, reset; fflush(); next}
       {print; fflush()}'
    local rc=${PIPESTATUS[0]}
    local errors; errors=$(awk '/^\s*[0-9]+\)\s/{f=1} f' "$_tmp")
    if [ -n "$errors" ]; then
      echo ""
      echo "${RED}===== FAILURES =====${RESET}"
      printf '%s\n' "$errors" | awk -v red="$RED" -v reset="$RESET" '{printf "%s%s%s\n", red, $0, reset}'
      ALL_ERRORS="${ALL_ERRORS}
=== $project $k/$n ===
${errors}"
    fi
    local pass_n fail_n
    pass_n=$(grep -c '✓' "$_tmp" 2>/dev/null || true)
    fail_n=$(grep -c '✘' "$_tmp" 2>/dev/null || true)
    TOTAL_PASS=$((TOTAL_PASS + pass_n))
    TOTAL_FAIL=$((TOTAL_FAIL + fail_n))
    echo "${DIM}shard result: ${pass_n} passed, ${fail_n} failed${RESET}"
    rm -f "$_tmp"
    ACTIVE_TMP=""
    if [ "$rc" != 0 ]; then
      FAILED="$FAILED $project:$k/$n"
      echo ">>> $project shard $k/$n exited $rc"
    fi
  done
}

echo "=== Sharded chromium E2E: heavy=$HEAVY_N + light=$LIGHT_N shards, fresh dev server per shard ==="
run_shards "chromium-heavy" "$HEAVY_N"
run_shards "chromium" "$LIGHT_N"
bash scripts/kill-dev-server.sh 3777 >/dev/null 2>&1 || true

# Write log
{
  echo "date:    $(date '+%Y-%m-%d %H:%M:%S')"
  echo "commit:  $(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "shards:  heavy=$HEAVY_N light=$LIGHT_N"
  echo "result:  ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed"
  if [ -n "$FAILED" ]; then
    echo "failed_shards:$FAILED"
    echo ""
    echo "FAILURE DETAILS:${ALL_ERRORS}"
  fi
} > "$LOGFILE"

echo ""
echo "======================================================="
if [ -z "$FAILED" ]; then
  echo "ALL SHARDS GREEN (heavy=$HEAVY_N, light=$LIGHT_N) — ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed"
  echo "${DIM}Log: ${LOGFILE}${RESET}"
  exit 0
else
  echo "SHARDS WITH FAILURES:$FAILED"
  echo "Re-run one with: npx playwright test --project=<chromium|chromium-heavy> --shard=k/N"
  echo "Total: ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed"
  echo "${DIM}Log: ${LOGFILE}${RESET}"
  exit 1
fi
