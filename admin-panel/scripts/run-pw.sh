#!/usr/bin/env bash
# Run Playwright tests with colorized output (real-time).
# Passes (✓) are dimmed, failures (✘) are bold red, error details are red.
# Usage: scripts/run-pw.sh [playwright args...]

RED=$'\033[1;31m'
GREEN=$'\033[32m'
DIM=$'\033[2m'
RESET=$'\033[0m'

_PW=$(mktemp)
trap 'rm -f "$_PW"' EXIT

# Single awk handles filtering + coloring + flushing in one process (no buffering issues)
FORCE_COLOR=0 npx playwright test "$@" --reporter=list 2>&1 | tee "$_PW" | awk -v red="$RED" -v dim="$DIM" -v reset="$RESET" \
  '/^\s*[0-9]*\s*✘/ {printf "%s%s%s\n", red, $0, reset; fflush(); next}
   /^\s*[0-9]*\s*✓/ {printf "%s%s%s\n", dim, $0, reset; fflush(); next}'

# Print error details (lines after "  N) ...")
ERRORS=$(awk '/^[[:space:]]+[0-9]+\) /{f=1} f' "$_PW")
if [ -n "$ERRORS" ]; then
  echo ""
  echo "${RED}===== FAILURES =====${RESET}"
  echo "$ERRORS" | awk -v red="$RED" -v reset="$RESET" '{printf "%s%s%s\n", red, $0, reset}'
fi

# Summary line
PASS=$(grep -c '✓' "$_PW" 2>/dev/null || true)
FAIL=$(grep -c '✘' "$_PW" 2>/dev/null || true)
PASS=${PASS:-0}
FAIL=${FAIL:-0}
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "${RED}Result: ${PASS} passed, ${FAIL} failed${RESET}"
  exit 1
else
  echo "${GREEN}Result: ${PASS} passed, 0 failed${RESET}"
fi
