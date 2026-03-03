#!/usr/bin/env bash
#
# Sellf Self-Upgrade Script
# Called by POST /api/v1/system/upgrade as a detached process.
# Writes progress to /tmp/sellf-upgrade-{TOKEN}.json for the frontend to poll.
#
# Usage: upgrade.sh <TOKEN> [INSTALL_DIR]
#   TOKEN       - UUID for progress tracking
#   INSTALL_DIR - optional, defaults to auto-detection
#
# Environment:
#   GITHUB_REPO - owner/repo (default: jurczykpawel/sellf)
#   PM2_NAME    - PM2 process name (default: auto-detect)

set -euo pipefail

# ===== ARGUMENTS =====
TOKEN="${1:?Usage: upgrade.sh <TOKEN> [INSTALL_DIR]}"
INSTALL_DIR="${2:-}"
GITHUB_REPO="${GITHUB_REPO:-jurczykpawel/sellf}"

# Validate TOKEN is a UUID (prevent injection via filename)
if ! [[ "$TOKEN" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "ERROR: Invalid token format" >&2
  exit 1
fi

LOCK_FILE="/tmp/sellf-upgrade.lock"
PROGRESS_FILE="/tmp/sellf-upgrade-${TOKEN}.json"
LOG_FILE="/tmp/sellf-upgrade-${TOKEN}.log"

# Restrict file permissions — progress/log files contain system info
touch "$PROGRESS_FILE" "$LOG_FILE"
chmod 600 "$PROGRESS_FILE" "$LOG_FILE"

# ===== HELPERS =====

# Write progress JSON safely using printf to avoid injection via message
write_progress() {
  local step="$1" progress="$2" message="$3"
  # Escape double quotes and backslashes in message for valid JSON
  local safe_msg
  safe_msg=$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"step":"%s","progress":%d,"message":"%s","timestamp":"%s"}\n' \
    "$step" "$progress" "$safe_msg" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PROGRESS_FILE"
}

write_error() {
  local message="$1" rollback="${2:-false}"
  local safe_msg
  safe_msg=$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"step":"failed","progress":-1,"message":"%s","rollback":%s,"timestamp":"%s"}\n' \
    "$safe_msg" "$rollback" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PROGRESS_FILE"
}

cleanup_lock() {
  rm -f "$LOCK_FILE"
}
trap cleanup_lock EXIT

log() {
  echo "[$(date -u +%H:%M:%S)] $*" >> "$LOG_FILE"
}

# ===== LOCK (atomic via flock) =====

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  write_error "Upgrade already in progress"
  exit 1
fi

# ===== AUTO-DETECT INSTALL DIR =====

if [ -z "$INSTALL_DIR" ]; then
  for candidate in /opt/stacks/sellf /root/sellf; do
    if [ -d "$candidate/.next/standalone" ]; then
      INSTALL_DIR="$candidate"
      break
    fi
  done
  # Check sellf-* variants separately with safe glob
  if [ -z "$INSTALL_DIR" ]; then
    for candidate in /opt/stacks/sellf-*/; do
      if [ -d "${candidate}.next/standalone" ]; then
        INSTALL_DIR="${candidate%/}"
        break
      fi
    done
  fi
fi

if [ -z "$INSTALL_DIR" ] || [ ! -d "$INSTALL_DIR" ]; then
  write_error "Could not find Sellf installation directory"
  exit 1
fi

log "Install dir: $INSTALL_DIR"

# ===== AUTO-DETECT PM2 NAME =====

PM2_NAME="${PM2_NAME:-}"
if [ -z "$PM2_NAME" ]; then
  # Pass INSTALL_DIR via environment variable to avoid shell injection in Python
  PM2_NAME=$(SELLF_INSTALL_DIR="$INSTALL_DIR" pm2 jlist 2>/dev/null | python3 -c "
import sys, json, os
try:
    install_dir = os.environ.get('SELLF_INSTALL_DIR', '')
    procs = json.load(sys.stdin)
    for p in procs:
        cwd = p.get('pm2_env', {}).get('pm_cwd', '')
        if install_dir and install_dir in cwd or 'sellf' in p.get('name', '').lower():
            print(p['name'])
            break
except: pass
" 2>/dev/null || true)
fi

if [ -z "$PM2_NAME" ]; then
  PM2_NAME="sellf"
  log "WARNING: Could not auto-detect PM2 name, using default: $PM2_NAME"
fi

log "PM2 name: $PM2_NAME"

# ===== STEP 1: GET LATEST RELEASE INFO =====

write_progress "checking" 5 "Checking latest release..."
log "Fetching latest release from GitHub..."

RELEASE_JSON=$(curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null) || {
  write_error "Failed to fetch release info from GitHub"
  exit 1
}

DOWNLOAD_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for asset in data.get('assets', []):
    if asset['name'].endswith('.tar.gz'):
        print(asset['browser_download_url'])
        break
" 2>/dev/null)

TAG_NAME=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tag_name','unknown'))" 2>/dev/null)

if [ -z "$DOWNLOAD_URL" ]; then
  write_error "No tar.gz asset found in latest release"
  exit 1
fi

# Validate tag_name is semver-like
if ! [[ "$TAG_NAME" =~ ^v?[0-9]+\.[0-9]+ ]]; then
  write_error "Invalid release tag format: $TAG_NAME"
  exit 1
fi

# Validate download URL points to GitHub
if ! [[ "$DOWNLOAD_URL" =~ ^https://github\.com/ ]]; then
  write_error "Unexpected download URL origin"
  exit 1
fi

log "Latest release: $TAG_NAME"
log "Download URL: $DOWNLOAD_URL"

# ===== STEP 2: DOWNLOAD =====

write_progress "downloading" 15 "Downloading ${TAG_NAME}..."
log "Downloading..."

TMP_DIR=$(mktemp -d)
ARCHIVE="$TMP_DIR/sellf-build.tar.gz"

curl -fSL --max-time 120 -o "$ARCHIVE" "$DOWNLOAD_URL" >> "$LOG_FILE" 2>&1 || {
  write_error "Failed to download release archive"
  rm -rf "$TMP_DIR"
  exit 1
}

log "Download complete: $(du -h "$ARCHIVE" | cut -f1)"

# ===== STEP 3: EXTRACT & VALIDATE =====

write_progress "extracting" 30 "Extracting archive..."
log "Extracting..."

EXTRACT_DIR="$TMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR" >> "$LOG_FILE" 2>&1 || {
  write_error "Failed to extract archive"
  rm -rf "$TMP_DIR"
  exit 1
}

# Validate archive structure
if [ ! -d "$EXTRACT_DIR/.next/standalone" ]; then
  write_error "Invalid archive: missing .next/standalone/"
  rm -rf "$TMP_DIR"
  exit 1
fi

# Security: reject archives with symlinks
if tar -tzf "$ARCHIVE" 2>/dev/null | grep -q '^l'; then
  write_error "Security: archive contains symlinks"
  rm -rf "$TMP_DIR"
  exit 1
fi

log "Archive validated OK"

# ===== STEP 4: BACKUP =====

write_progress "backing_up" 45 "Creating backup..."
log "Backing up current installation..."

BACKUP_DIR="$INSTALL_DIR/.backup"
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Backup .env.local
if [ -f "$INSTALL_DIR/.env.local" ]; then
  cp "$INSTALL_DIR/.env.local" "$BACKUP_DIR/.env.local"
  chmod 600 "$BACKUP_DIR/.env.local"
fi

# Backup current .next and package.json for rollback
if [ -d "$INSTALL_DIR/.next" ]; then
  cp -r "$INSTALL_DIR/.next" "$BACKUP_DIR/.next"
fi
if [ -f "$INSTALL_DIR/package.json" ]; then
  cp "$INSTALL_DIR/package.json" "$BACKUP_DIR/package.json"
fi
if [ -d "$INSTALL_DIR/public" ]; then
  cp -r "$INSTALL_DIR/public" "$BACKUP_DIR/public"
fi

log "Backup created at $BACKUP_DIR"

# ===== STEP 5: STOP PM2 =====

write_progress "stopping" 55 "Stopping application..."
log "Stopping PM2 process: $PM2_NAME"

pm2 stop "$PM2_NAME" >> "$LOG_FILE" 2>&1 || log "WARNING: PM2 stop failed (process may not be running)"

# ===== STEP 6: SWAP FILES =====

write_progress "installing" 65 "Installing new version..."
log "Swapping files..."

# Remove old build artifacts
rm -rf "$INSTALL_DIR/.next"
rm -rf "$INSTALL_DIR/public"

# Copy new files
cp -r "$EXTRACT_DIR/.next" "$INSTALL_DIR/"
cp -r "$EXTRACT_DIR/public" "$INSTALL_DIR/" 2>/dev/null || true
cp "$EXTRACT_DIR/package.json" "$INSTALL_DIR/" 2>/dev/null || true
cp "$EXTRACT_DIR/bun.lock" "$INSTALL_DIR/" 2>/dev/null || true

# Copy upgrade script itself (self-update)
if [ -f "$EXTRACT_DIR/scripts/upgrade.sh" ]; then
  mkdir -p "$INSTALL_DIR/scripts"
  cp "$EXTRACT_DIR/scripts/upgrade.sh" "$INSTALL_DIR/scripts/upgrade.sh" 2>/dev/null || true
  chmod +x "$INSTALL_DIR/scripts/upgrade.sh" 2>/dev/null || true
fi

# Copy supabase migrations
if [ -d "$EXTRACT_DIR/supabase" ]; then
  cp -r "$EXTRACT_DIR/supabase" "$INSTALL_DIR/" 2>/dev/null || true
fi

# Restore .env.local from backup
if [ -f "$BACKUP_DIR/.env.local" ]; then
  cp "$BACKUP_DIR/.env.local" "$INSTALL_DIR/.env.local"
fi

# Copy .env.local into standalone dir
STANDALONE_DIR="$INSTALL_DIR/.next/standalone/admin-panel"
if [ -d "$STANDALONE_DIR" ] && [ -f "$INSTALL_DIR/.env.local" ]; then
  cp "$INSTALL_DIR/.env.local" "$STANDALONE_DIR/.env.local"
fi

log "Files swapped"

# ===== STEP 7: RUN MIGRATIONS =====

write_progress "migrating" 75 "Running database migrations..."
log "Running migrations..."

# Read Supabase connection info from .env.local
SUPABASE_URL=$(grep -E '^SUPABASE_URL=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2- || true)
SERVICE_KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2- || true)

if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ] && [ -d "$INSTALL_DIR/supabase/migrations" ]; then
  if ! command -v jq &>/dev/null; then
    log "WARNING: jq not installed — skipping automated migrations (apt-get install jq)"
  else
    # Check which migrations are already applied via RPC
    APPLIED=$(curl -sf "${SUPABASE_URL}/rest/v1/rpc/get_migration_status" \
      -H "apikey: ${SERVICE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -d '{}' 2>/dev/null || echo "RPC_NOT_FOUND")

    if [ "$APPLIED" = "RPC_NOT_FOUND" ]; then
      log "Migration RPC not available yet — skipping automated migrations"
      log "Run 'deploy.sh sellf --update' once to bootstrap migration system"
    else
      MIGRATION_COUNT=0
      MIGRATION_ERRORS=0

      for migration_file in "$INSTALL_DIR/supabase/migrations/"*.sql; do
        [ -f "$migration_file" ] || continue
        [ -d "$migration_file" ] && continue
        VERSION=$(basename "$migration_file" .sql)

        # Skip if already applied
        echo "$APPLIED" | grep -q "\"$VERSION\"" && continue

        SQL_CONTENT=$(cat "$migration_file")
        CHECKSUM=$(echo -n "$SQL_CONTENT" | sha256sum | cut -d' ' -f1)

        # Call RPC — jq handles JSON escaping of SQL content safely
        RESULT=$(curl -sf "${SUPABASE_URL}/rest/v1/rpc/apply_migration" \
          -H "apikey: ${SERVICE_KEY}" \
          -H "Authorization: Bearer ${SERVICE_KEY}" \
          -H "Content-Type: application/json" \
          -d "$(jq -n \
            --arg v "$VERSION" \
            --arg s "$SQL_CONTENT" \
            --arg c "$CHECKSUM" \
            '{migration_version: $v, migration_sql: $s, content_checksum: $c}')" \
          2>>"$LOG_FILE") || {
          log "WARNING: Migration $VERSION failed"
          MIGRATION_ERRORS=$((MIGRATION_ERRORS + 1))
          continue
        }

        log "Migration $VERSION: $RESULT"
        MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
      done

      log "Migrations complete: $MIGRATION_COUNT applied, $MIGRATION_ERRORS errors"
    fi
  fi
else
  log "Skipping migrations (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)"
fi

# ===== STEP 8: START PM2 =====

write_progress "restarting" 90 "Starting application..."
log "Starting PM2 process..."

# Determine server.js path
SERVER_JS="$INSTALL_DIR/.next/standalone/admin-panel/server.js"
if [ ! -f "$SERVER_JS" ]; then
  SERVER_JS="$INSTALL_DIR/.next/standalone/server.js"
fi

if [ ! -f "$SERVER_JS" ]; then
  log "ERROR: server.js not found — rolling back!"
  write_progress "rolling_back" 95 "Error: server.js not found. Rolling back..."
  # Rollback
  rm -rf "$INSTALL_DIR/.next" "$INSTALL_DIR/public"
  cp -r "$BACKUP_DIR/.next" "$INSTALL_DIR/" 2>/dev/null || true
  cp -r "$BACKUP_DIR/public" "$INSTALL_DIR/" 2>/dev/null || true
  cp "$BACKUP_DIR/package.json" "$INSTALL_DIR/" 2>/dev/null || true
  if [ -f "$BACKUP_DIR/.env.local" ]; then
    cp "$BACKUP_DIR/.env.local" "$INSTALL_DIR/.env.local"
  fi
  pm2 start "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
  write_error "Upgrade failed: server.js not found. Rolled back to previous version." true
  rm -rf "$TMP_DIR"
  exit 1
fi

# Read PORT from .env.local and validate
PORT=$(grep -E '^PORT=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2 || true)
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  PORT=3333
fi

# Delete old PM2 entry and start fresh
pm2 delete "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
cd "$(dirname "$SERVER_JS")"
PORT="${PORT}" HOSTNAME="::" pm2 start "$(basename "$SERVER_JS")" --name "$PM2_NAME" >> "$LOG_FILE" 2>&1

# Wait for app to start and verify
sleep 5
HEALTH_OK=false
for i in $(seq 1 12); do
  if curl -sf "http://localhost:${PORT}/api/health" > /dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [ "$HEALTH_OK" = "true" ]; then
  pm2 save >> "$LOG_FILE" 2>&1 || true
  write_progress "done" 100 "Upgrade to ${TAG_NAME} completed successfully!"
  log "Upgrade complete! Version: $TAG_NAME"
else
  log "ERROR: Health check failed after 60s — rolling back!"
  write_progress "rolling_back" 95 "Health check failed. Rolling back..."

  pm2 stop "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
  pm2 delete "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true

  rm -rf "$INSTALL_DIR/.next" "$INSTALL_DIR/public"
  cp -r "$BACKUP_DIR/.next" "$INSTALL_DIR/" 2>/dev/null || true
  cp -r "$BACKUP_DIR/public" "$INSTALL_DIR/" 2>/dev/null || true
  cp "$BACKUP_DIR/package.json" "$INSTALL_DIR/" 2>/dev/null || true

  # Restart with old version
  OLD_SERVER_JS="$INSTALL_DIR/.next/standalone/admin-panel/server.js"
  [ ! -f "$OLD_SERVER_JS" ] && OLD_SERVER_JS="$INSTALL_DIR/.next/standalone/server.js"
  if [ -f "$OLD_SERVER_JS" ]; then
    cd "$(dirname "$OLD_SERVER_JS")"
    PORT="${PORT}" HOSTNAME="::" pm2 start "$(basename "$OLD_SERVER_JS")" --name "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
    pm2 save >> "$LOG_FILE" 2>&1 || true
  fi

  write_error "Upgrade failed: health check timeout. Rolled back to previous version." true
  rm -rf "$TMP_DIR"
  exit 1
fi

# ===== CLEANUP =====

rm -rf "$TMP_DIR"
log "Temp files cleaned up. Backup preserved at $BACKUP_DIR"
