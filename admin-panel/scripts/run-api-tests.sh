#!/usr/bin/env bash
# Run Vitest API integration tests against a freshly-started Next.js dev server.
# Starts dev on :3777, waits for /api/runtime-config to respond, runs tests,
# then kills the server. Idempotent — if a server is already on :3777, reuses it.

set -u

LOG=/tmp/sellf-api-tests-dev.log
PORT=3777

started_us=0
if ! curl -fsS http://localhost:$PORT/api/runtime-config -o /dev/null 2>/dev/null; then
  PORT=$PORT nohup bun run dev > "$LOG" 2>&1 &
  SERVER_PID=$!
  started_us=1
  trap '[ "$started_us" = 1 ] && kill "$SERVER_PID" 2>/dev/null; bash scripts/kill-dev-server.sh >/dev/null 2>&1 || true' EXIT INT TERM
  echo "[run-api-tests] Waiting for dev server on :$PORT (log: $LOG)..."
  for _ in $(seq 1 90); do
    if curl -fsS http://localhost:$PORT/api/runtime-config -o /dev/null 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if ! curl -fsS http://localhost:$PORT/api/runtime-config -o /dev/null 2>/dev/null; then
    echo "[run-api-tests] Dev server failed to start; tail of $LOG:" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  # Brief warm-up so first request doesn't race route compilation in Turbopack
  sleep 3
else
  echo "[run-api-tests] Reusing existing dev server on :$PORT"
fi

TEST_API_URL=http://localhost:$PORT bun run test:api
