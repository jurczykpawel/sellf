#!/usr/bin/env bash
# Run Playwright tests with colorized output and persistent result log.
# Passes (✓) are dimmed, failures (✘) are bold red, error details are red.
# Results saved to test-runs/ for future reference.
# Usage: scripts/run-pw.sh [playwright args...]

RED=$'\033[1;31m'
GREEN=$'\033[32m'
DIM=$'\033[2m'
RESET=$'\033[0m'

_PW=$(mktemp)
trap 'rm -f "$_PW"' EXIT

FORCE_COLOR=0 npx playwright test "$@" --reporter=list 2>&1 | tee "$_PW" | grep -E '^\s*[✓✘]' | awk -v red="$RED" -v green="$GREEN" -v dim="$DIM" -v reset="$RESET" \
  '/✘/ {printf "%s%s%s\n", red, $0, reset; next}
   /✓/ {printf "%s%s%s\n", dim, $0, reset; next}
   {print}'

# Print error details (Playwright list reporter prints numbered failures at the bottom)
ERRORS=$(awk '/^\s*[0-9]+\)\s/{f=1} f' "$_PW")
if [ -n "$ERRORS" ]; then
  echo ""
  echo "${RED}===== FAILURES =====${RESET}"
  echo "$ERRORS" | awk -v red="$RED" -v reset="$RESET" '{printf "%s%s%s\n", red, $0, reset}'
fi

# Collect error-context.md snapshots from test-results/ (Playwright writes one
# per failed test). These get overwritten on the next playwright invocation, so
# snapshotting them into the log preserves diagnostics across the ttt/tttt
# multi-phase runs.
RESULTS_DIR="test-results"
ERROR_CTX_SNAPSHOT=""
if [ -d "$RESULTS_DIR" ]; then
  while IFS= read -r ctx; do
    [ -z "$ctx" ] && continue
    ERROR_CTX_SNAPSHOT="${ERROR_CTX_SNAPSHOT}

----- ${ctx} -----
$(cat "$ctx")"
  done < <(find "$RESULTS_DIR" -name 'error-context.md' -type f 2>/dev/null | sort)
fi

# Summary line
PASS=$(grep -c '✓' "$_PW" 2>/dev/null || true)
FAIL=$(grep -c '✘' "$_PW" 2>/dev/null || true)
FLAKY=$(grep -c 'flaky' "$_PW" 2>/dev/null || true)
PASS=${PASS:-0}
FAIL=${FAIL:-0}
FLAKY=${FLAKY:-0}

# Save result to test-runs/
mkdir -p test-runs
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
COMMIT_FULL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
COMMIT_SUBJECT=$(git log -1 --format='%s' HEAD 2>/dev/null || echo "")
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
DIRTY=$([ -n "$(git status --porcelain 2>/dev/null)" ] && echo "yes" || echo "no")
MAIN_HEAD=$(git rev-parse --short main 2>/dev/null || echo "unknown")
MAIN_HEAD_FULL=$(git rev-parse main 2>/dev/null || echo "unknown")
MERGE_BASE=$(git merge-base HEAD main 2>/dev/null | cut -c1-7 || echo "unknown")
AHEAD=$(git rev-list --count main..HEAD 2>/dev/null || echo "?")
BEHIND=$(git rev-list --count HEAD..main 2>/dev/null || echo "?")
ARGS="${*:-default}"
LOGFILE="test-runs/${TIMESTAMP}_${COMMIT}.log"

{
  echo "date:           $(date '+%Y-%m-%d %H:%M:%S')"
  echo "commit:         ${COMMIT_FULL}"
  echo "commit_short:   ${COMMIT} (${BRANCH})"
  echo "commit_subject: ${COMMIT_SUBJECT}"
  echo "dirty:          ${DIRTY}"
  echo "main_head:      ${MAIN_HEAD_FULL} (${MAIN_HEAD})"
  echo "branch_base:    ${MERGE_BASE}"
  echo "vs_main:        ${AHEAD} ahead, ${BEHIND} behind"
  echo "args:           ${ARGS}"
  echo "result:         ${PASS} passed, ${FAIL} failed, ${FLAKY} flaky"
  echo ""
  if [ "$FAIL" -gt 0 ]; then
    echo "FAILURES:"
    grep '✘' "$_PW" | sed 's/^[[:space:]]*/  /'
    echo ""
    echo "ERROR DETAILS:"
    echo "$ERRORS"
    if [ -n "$ERROR_CTX_SNAPSHOT" ]; then
      echo ""
      echo "ERROR CONTEXT (test-results/*/error-context.md snapshots):"
      echo "$ERROR_CTX_SNAPSHOT"
    fi
  fi
  if [ "$FLAKY" -gt 0 ]; then
    echo "FLAKY:"
    grep -i 'flaky' "$_PW" | sed 's/^[[:space:]]*/  /'
  fi
} > "$LOGFILE"

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "${RED}Result: ${PASS} passed, ${FAIL} failed${RESET}"
  echo "${DIM}Log: ${LOGFILE}${RESET}"
  exit 1
else
  echo "${GREEN}Result: ${PASS} passed, 0 failed${RESET}"
  echo "${DIM}Log: ${LOGFILE}${RESET}"
fi
