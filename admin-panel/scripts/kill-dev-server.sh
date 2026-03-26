#!/usr/bin/env bash
# Kill the Next.js dev server between Playwright test passes.
# Next.js 16 writes .next/dev/lock with PID — kill that process and remove the lock.

LOCK=".next/dev/lock"

# Kill by PID from lock file (survives even after port is released)
if [ -f "$LOCK" ]; then
  PID=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$LOCK','utf8')).pid)}catch(e){}" 2>/dev/null)
  if [ -n "$PID" ]; then
    kill -9 "$PID" 2>/dev/null
  fi
  rm -f "$LOCK"
fi

# Kill anything still on test ports
kill $(lsof -ti:3777) $(lsof -ti:3778) 2>/dev/null
sleep 1
