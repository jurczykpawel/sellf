#!/usr/bin/env bash
# Run the complete local test pipeline with optional database reset.

set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  bash scripts/kill-dev-server.sh 3777 3778 >/dev/null 2>&1 || true
  exit "$status"
}

trap cleanup EXIT INT TERM

if [ "${1:-}" = "--reset-db" ]; then
  echo "=== Resetting local Supabase database ==="
  (cd .. && npx supabase db reset)
elif [ "$#" -gt 0 ]; then
  echo "Usage: scripts/run-full-tests.sh [--reset-db]" >&2
  exit 2
fi

echo "=== API integration tests ==="
scripts/run-api-tests.sh

echo "=== Sharded Chromium E2E tests ==="
scripts/run-pw-sharded.sh

echo "=== Rate-limiting E2E tests ==="
RATE_LIMIT_TEST_MODE=true scripts/run-pw.sh \
  --project=rate-limiting \
  --project=rate-limiting-v1

