#!/bin/bash
# =============================================================================
# Sellf Demo Instance — Database Reset Script
# =============================================================================
#
# Resets the demo database to seed data via Supabase RPC (no psql/CLI needed).
# Uses the same SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY as the app.
#
# Prerequisites:
#   1. Apply demo-reset-function.sql to the database (one-time via SQL Editor)
#   2. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment or .env.local
#
# Cron (reset every hour):
#   0 * * * * /path/to/sellf/scripts/demo-reset.sh >> /var/log/sellf-demo-reset.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load env vars from .env.local if not already set
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  ENV_FILE="$PROJECT_ROOT/admin-panel/.env.local"
  if [ -f "$ENV_FILE" ]; then
    SUPABASE_URL="${SUPABASE_URL:-$(grep -E '^SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2-)}"
    SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | head -1 | cut -d'=' -f2-)}"
  fi
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
  echo "Set them as env vars or add to admin-panel/.env.local"
  exit 1
fi

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting demo database reset..."

# Content-Profile=public — demo_reset_data lives in public, not seller_main (the PostgREST default).
# `|| echo …000` keeps curl failures in the error branch under `set -e`.
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${SUPABASE_URL}/rest/v1/rpc/demo_reset_data" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Content-Profile: public" \
  -d '{}' || echo $'\n000')

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
[ -z "$HTTP_STATUS" ] && HTTP_STATUS="000"

if [ "$HTTP_STATUS" = "204" ] || [ "$HTTP_STATUS" = "200" ]; then
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Demo database reset completed successfully."
else
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] ERROR: Reset failed (HTTP $HTTP_STATUS)"
  echo "$BODY"

  # Optional ntfy alert — requires NTFY_BIN + NTFY_TOPIC in env.
  # NTFY_COOLDOWN_SEC defaults to 3600s to avoid spamming on hourly cron failures.
  NTFY_BIN="${NTFY_BIN:-}"
  NTFY_TOPIC="${NTFY_TOPIC:-}"
  NTFY_COOLDOWN_SEC="${NTFY_COOLDOWN_SEC:-3600}"
  COOLDOWN_FILE="/tmp/sellf-demo-reset.ntfy-cooldown"

  now=$(date +%s)
  last=0
  [ -f "$COOLDOWN_FILE" ] && last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)

  if [ -n "$NTFY_BIN" ] && [ -n "$NTFY_TOPIC" ] && [ -x "$NTFY_BIN" ] && (( now - last >= NTFY_COOLDOWN_SEC )); then
    # Strip quotes/backslashes/newlines — ntfy helper builds JSON by string-concat without escaping.
    short_body=$(echo "$BODY" | tr -d '"\\' | tr '\n' ' ' | head -c 300)
    msg="HTTP $HTTP_STATUS"
    [ -n "$short_body" ] && msg="$msg: $short_body"
    "$NTFY_BIN" -t "Sellf demo reset failed" -p 4 -i warning \
      "$NTFY_TOPIC" "$msg" >/dev/null 2>&1 || true
    echo "$now" > "$COOLDOWN_FILE"
  fi

  exit 1
fi
