#!/usr/bin/env bash
# Verify the relocatable release contains no build-placeholder URL/key literals.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d .next/server ]; then
  echo 'Missing .next/server; build the application first.' >&2
  exit 1
fi
# Literal placeholder hosts must not appear even in server-rendered HTML/JSON.
pattern='placeholder[.]example[.]com|your-domain[.]com|placeholder[.]supabase[.]co|placeholder-anon-key'
roots=(.next/server)
if [ -d .next/static ]; then roots+=(.next/static); fi
while IFS= read -r directory; do roots+=("$directory"); done < <(find .next/standalone -type d -path '*/.next/server' 2>/dev/null)
if grep -RIlE --exclude='*.map' "$pattern" "${roots[@]}"; then
  echo 'FAIL: build placeholders found in release artifact.' >&2
  exit 1
else
  scan_status=$?
  if [ "$scan_status" -ne 1 ]; then
    echo 'FAIL: artifact scan could not complete.' >&2
    exit "$scan_status"
  fi
fi
echo 'PASS: release artifact contains no build placeholders.'
