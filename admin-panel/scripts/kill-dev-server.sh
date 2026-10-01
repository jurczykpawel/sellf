#!/usr/bin/env bash
# Kill Next.js dev servers listening on explicit test ports.
# Defaults preserve the existing Playwright cleanup behavior.

LOCK=".next/dev/lock"
PORTS=("$@")

if [ "${#PORTS[@]}" -eq 0 ]; then
  PORTS=(3777 3778)
fi

PIDS=()
for port in "${PORTS[@]}"; do
  while IFS= read -r pid; do
    [ -n "$pid" ] && PIDS+=("$pid")
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
done

if [ "${#PIDS[@]}" -gt 0 ]; then
  kill "${PIDS[@]}" 2>/dev/null || true
  sleep 1

  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
fi

# A dead PID does not guarantee the kernel has released the listening socket yet —
# signal delivery (especially SIGKILL) is asynchronous, and under load the process
# can take longer than expected to actually exit. Poll each port until nothing is
# LISTENING on it (bounded deadline) before returning, so the caller never starts a
# fresh server against a port that is still momentarily held by the one we just
# killed. Without this, Playwright's own webServer step can see "port already in
# use" and abort the whole shard with 0 tests executed.
DEADLINE_S=10
TICK_S=0.2
TICKS=$(awk -v d="$DEADLINE_S" -v t="$TICK_S" 'BEGIN { printf "%d", d / t }')
for port in "${PORTS[@]}"; do
  waited=0
  while lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$TICKS" ]; then
      echo "kill-dev-server.sh: port $port still held after ${DEADLINE_S}s deadline, giving up" >&2
      break
    fi
    sleep "$TICK_S"
  done
done

# Next.js can leave the lock behind after a forced or interrupted shutdown.
rm -f "$LOCK"
