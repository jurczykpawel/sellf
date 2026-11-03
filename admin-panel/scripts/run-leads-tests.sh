#!/usr/bin/env bash
# PlayerStack lead gate: starts the fixture host/receiver and a dedicated dev server, runs the HTTP
# contract and, when PLAYERSTACK_TEST_DIST points to a built PlayerStack, the browser journey.
# Ports/origin come from env (tests/leads/stack.ts): LEADS_APP_PORT, LEADS_HOST_PORT, LEADS_RECEIVER_PORT.
set -uo pipefail
cd "$(dirname "$0")/.."
export LEADS_APP_PORT="${LEADS_APP_PORT:-3893}" LEADS_HOST_PORT="${LEADS_HOST_PORT:-3894}" LEADS_RECEIVER_PORT="${LEADS_RECEIVER_PORT:-3895}"
export LEADS_API_BASE_URL="${LEADS_API_BASE_URL:-http://localhost:$LEADS_APP_PORT}"
export LEADS_ALLOWED_ORIGIN="${LEADS_ALLOWED_ORIGIN:-http://localhost:$LEADS_HOST_PORT}"
export LEADS_E2E_CA_FILE="$PWD/test-results/leads-receiver-cert.pem"
LOG_DIR="${LEADS_LOG_DIR:-test-results/leads-logs}"; mkdir -p "$LOG_DIR"
PIDS=()
cleanup() {
  local status=$?; trap - EXIT INT TERM
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  bash scripts/kill-dev-server.sh "$LEADS_APP_PORT" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM
bash scripts/kill-dev-server.sh "$LEADS_APP_PORT" >/dev/null 2>&1 || true

bun tests/fixtures/playerstack-leads/server.mjs > "$LOG_DIR/fixture.log" 2>&1 & PIDS+=($!)
RATE_LIMIT_TEST_MODE=true LEADS_E2E_TRANSPORT=1 SELLF_TELEMETRY_DISABLED=true SELLF_EMBED_ALLOWED_ORIGINS="$LEADS_ALLOWED_ORIGIN" \
  NODE_OPTIONS="--import $PWD/tests/fixtures/playerstack-leads/webhook-transport.mjs" \
  bun run dev --port "$LEADS_APP_PORT" --hostname 127.0.0.1 > "$LOG_DIR/app.log" 2>&1 & PIDS+=($!)

ready=0
for _ in $(seq 1 120); do
  if curl -fsS --max-time 2 "$LEADS_API_BASE_URL/api/health" -o /dev/null 2>/dev/null \
    && curl -fsS --max-time 2 "$LEADS_ALLOWED_ORIGIN/hooks" -o /dev/null 2>/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then echo "[run-leads-tests] stack not ready; see $LOG_DIR" >&2; tail -20 "$LOG_DIR"/*.log >&2; exit 1; fi

# Compile the lead routes before measuring them (a cold first compile can drop the first connections).
for path in /api/leads/challenge /api/leads/submit /api/products/warmup/playerstack; do
  curl -s --max-time 300 -o /dev/null "$LEADS_API_BASE_URL$path" || true
done

echo "=== PlayerStack lead HTTP contract ==="
bun x vitest run --config vitest.leads.config.ts || exit 1
if [ -n "${PLAYERSTACK_TEST_DIST:-}" ]; then
  echo "=== PlayerStack lead browser journey ==="
  LEADS_REUSE_SERVERS=1 bun x playwright test --config playwright.leads.config.ts --workers=1 || exit 1
else
  echo "[run-leads-tests] PLAYERSTACK_TEST_DIST not set: browser journey skipped (HTTP contract ran)." >&2
fi
