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
cd "$(dirname "$0")/.."

LIGHT_N="${1:-6}"
HEAVY_N="${2:-4}"
FAILED=""

run_shards() {
  local project="$1" n="$2"
  [ "$n" -ge 1 ] 2>/dev/null || { echo "(skip $project: 0 shards)"; return 0; }
  for k in $(seq 1 "$n"); do
    echo ""
    echo "===================== $project shard $k/$n ====================="
    kill $(lsof -ti:3777 2>/dev/null) 2>/dev/null; sleep 1
    # Wipe Turbopack's persistent on-disk cache before each fresh server. Killing the
    # dev server between shards can interrupt Turbopack mid-write to .next/dev/cache,
    # leaving a dangling .meta -> missing .sst reference. The NEXT server then panics on
    # boot ("Failed to lookup task ids ... Failed to open SST file"), serves no pages,
    # and the whole shard fails. Starting each shard from a clean cache removes the class.
    rm -rf .next/dev/cache 2>/dev/null
    FORCE_COLOR=0 npx playwright test --project="$project" --shard="$k/$n" --reporter=line
    local rc=$?
    if [ "$rc" != 0 ]; then
      FAILED="$FAILED $project:$k/$n"
      echo ">>> $project shard $k/$n exited $rc"
    fi
  done
}

echo "=== Sharded chromium E2E: heavy=$HEAVY_N + light=$LIGHT_N shards, fresh dev server per shard ==="
run_shards "chromium-heavy" "$HEAVY_N"
run_shards "chromium" "$LIGHT_N"
kill $(lsof -ti:3777 2>/dev/null) 2>/dev/null

echo ""
echo "======================================================="
if [ -z "$FAILED" ]; then
  echo "ALL SHARDS GREEN (heavy=$HEAVY_N, light=$LIGHT_N)"
  exit 0
else
  echo "SHARDS WITH FAILURES:$FAILED"
  echo "Re-run one with: npx playwright test --project=<chromium|chromium-heavy> --shard=k/N"
  exit 1
fi
