#!/usr/bin/env bash
# Run Vitest API integration tests against a fresh Next.js dev server.
# Port 3777 is dedicated to this runner; stale processes are removed first.

set -uo pipefail

LOG=/tmp/sellf-api-tests-dev.log
PORT=3777
SERVER_PID=''

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  bash scripts/kill-dev-server.sh "$PORT" >/dev/null 2>&1 || true
  exit "$status"
}

trap cleanup EXIT INT TERM

# A previous interrupted run must never be mistaken for this run's server.
bash scripts/kill-dev-server.sh "$PORT" >/dev/null 2>&1 || true
: > "$LOG"

# Real ALTCHA verification (magic-link + captcha replay tests need it), regardless of .env.local.
E2E_MODE=true NEXT_PUBLIC_TURNSTILE_TEST_MODE=false PORT=$PORT bun run dev > "$LOG" 2>&1 &
SERVER_PID=$!

echo "[run-api-tests] Waiting for fresh dev server on :$PORT (log: $LOG)..."
ready=0
for _ in $(seq 1 90); do
  if curl --connect-timeout 1 --max-time 2 -fsS \
    "http://localhost:$PORT/api/runtime-config" -o /dev/null 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "[run-api-tests] Dev server failed to start; tail of $LOG:" >&2
  tail -40 "$LOG" >&2
  exit 1
fi

# Compile the localized home route before tests so hooks measure the app, not the first build.
if ! curl -fsS --connect-timeout 5 --max-time 300 "http://localhost:$PORT/" -o /dev/null; then
  echo "[run-api-tests] Home route did not respond; tail of $LOG:" >&2
  tail -40 "$LOG" >&2
  exit 1
fi

TEST_API_URL=http://localhost:$PORT bun run test:api
