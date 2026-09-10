#!/usr/bin/env bash
# Confirms a Supabase project rejects a direct anon-key OTP request that
# carries no captcha token. Usage: verify-auth-captcha.sh <supabase_url> <anon_key>
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "FAIL: curl is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required" >&2
  exit 1
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <supabase_url> <anon_key>" >&2
  exit 1
fi

SUPABASE_URL="${1%/}"
ANON_KEY="$2"

response="$(
  curl -sS -X POST "${SUPABASE_URL}/auth/v1/otp" \
    -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"email":"captcha-probe@invalid.example","create_user":false}'
)"

error_code="$(echo "$response" | jq -r '.error_code // empty')"

if [ "$error_code" = "captcha_failed" ]; then
  echo "OK: Supabase Auth rejects captcha-less OTP"
  exit 0
fi

echo "FAIL: direct OTP accepted without captcha — enable Auth captcha (Turnstile/hCaptcha) in Supabase"
exit 1
