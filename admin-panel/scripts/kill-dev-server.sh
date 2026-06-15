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

# Next.js can leave the lock behind after a forced or interrupted shutdown.
rm -f "$LOCK"
