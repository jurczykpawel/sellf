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

# Without a prebuilt distribution, build PlayerStack at the pinned adapter commit (its lockfile needs bun >= 1.4.3 that
# reads lockfileVersion 2; point PLAYERSTACK_BUN at it). The PlayerStack checkout itself is never modified.
PIN=8baee66c50a95e21aee91fca66a2edc53bc08538
PS_REPO="${PLAYERSTACK_ADAPTER_REPO:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/../playerstack}"
if [ -z "${PLAYERSTACK_TEST_DIST:-}" ] && git -C "$PS_REPO" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  BUILD_DIR="${PLAYERSTACK_BUILD_DIR:-${TMPDIR:-/tmp}/sellf-playerstack-$PIN}"  # outside the app: the dev server must not watch it
  if [ ! -f "$BUILD_DIR/packages/embed/dist/playerstack-plugin-email-gate.js" ]; then
    rm -rf "$BUILD_DIR"; mkdir -p "$BUILD_DIR"
    git -C "$PS_REPO" archive "$PIN" | tar -x -C "$BUILD_DIR"
    (cd "$BUILD_DIR" && "${PLAYERSTACK_BUN:-bun}" install --frozen-lockfile && cd packages/embed && "${PLAYERSTACK_BUN:-bun}" run build) \
      > "$LOG_DIR/playerstack-build.log" 2>&1 || echo "[run-leads-tests] PlayerStack build failed; see $LOG_DIR/playerstack-build.log" >&2
  fi
  [ -f "$BUILD_DIR/packages/embed/dist/playerstack-plugin-email-gate.js" ] && export PLAYERSTACK_TEST_DIST="$BUILD_DIR/packages/embed/dist"
fi
bun tests/fixtures/playerstack-leads/server.mjs > "$LOG_DIR/fixture.log" 2>&1 & PIDS+=($!)
# Links in e-mails must point at this app, whatever .env.local says.
NEXT_PUBLIC_SITE_URL="$LEADS_API_BASE_URL" NEXT_PUBLIC_BASE_URL="$LEADS_API_BASE_URL" \
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
