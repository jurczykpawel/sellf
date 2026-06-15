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

  # Wait for PostgREST schema cache and Supabase Auth to be ready.
  # After db reset both services reload internally; hitting them immediately
  # produces PGRST205 ("schema cache not found") or AuthApiError
  # ("Database error checking email") which cascade into beforeAll failures.
  echo "=== Waiting for PostgREST schema cache to warm up ==="
  SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
  SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz}"
  for i in $(seq 1 30); do
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "apikey: $SERVICE_KEY" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      "${SUPABASE_URL}/rest/v1/products?select=id&limit=1")
    if [ "$status" = "200" ] || [ "$status" = "206" ]; then
      echo "  PostgREST ready (${i}s)"
      break
    fi
    if [ "$i" = "30" ]; then
      echo "  WARNING: PostgREST not ready after 30s, continuing anyway" >&2
    fi
    sleep 1
  done
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

