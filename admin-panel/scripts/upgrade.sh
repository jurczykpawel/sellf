#!/usr/bin/env bash
#
# Sellf Self-Upgrade Script
# Called by POST /api/v1/system/upgrade as a detached process.
# Writes progress to <runtime dir>/sellf-upgrade-{TOKEN}.json for the frontend
# to poll (runtime dir prefers /run/sellf, falls back to /tmp — see below).
#
# Usage: upgrade.sh <TOKEN> [INSTALL_DIR]
#   TOKEN       - UUID for progress tracking
#   INSTALL_DIR - optional, defaults to auto-detection
#
# Environment:
#   GITHUB_REPO - owner/repo (default: jurczykpawel/sellf)
#   PM2_NAME    - PM2 process name (default: auto-detect)
#
# Only a release whose manifest carries a valid signature from the key
# embedded below, and whose version is not older than the installed one, is
# installed. There is no switch that relaxes either check.

set -euo pipefail

# Force bash to read the entire script into memory before executing.
# Without this, the self-update step (cp new upgrade.sh over the running one)
# corrupts bash's read offset, causing "command not found" errors mid-run.
main() {

# Ensure PM2 can locate its socket regardless of how this script was spawned.
# When called from Node.js (detached child_process), $HOME may be unset or
# wrong, causing PM2 to use /etc/.pm2 instead of /root/.pm2.
export HOME="${HOME:-/root}"
export PM2_HOME="${PM2_HOME:-${HOME}/.pm2}"

# ===== ARGUMENTS =====
TOKEN="${1:?Usage: upgrade.sh <TOKEN> [INSTALL_DIR]}"
INSTALL_DIR="${2:-}"
GITHUB_REPO="${GITHUB_REPO:-jurczykpawel/sellf}"

# ===== RELEASE SIGNING KEY =====
# Ed25519 public key whose private half signs every release's
# sellf-build.manifest in CI (.github/workflows/build-release.yml,
# secret RELEASE_SIGNING_KEY). The key the check uses is the one embedded in
# the script that is ALREADY INSTALLED and running — never one taken from
# the downloaded archive, which is untrusted until verified. A new key only
# reaches a server inside a release signed by the previous key.
# Mirror for auditing: scripts/release-signing-key.pub.pem (kept identical by
# tests/unit/scripts/upgrade-archive-validation.test.ts).
# release-signing-key:start
RELEASE_SIGNING_PUBKEY=$(cat <<'PEM'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA02w9x0hle3SJILFgdRo5vqykMVohu4XRQw4F9awhsuc=
-----END PUBLIC KEY-----
PEM
)
# release-signing-key:end

# Validate TOKEN is a UUID (prevent injection via filename)
if ! [[ "$TOKEN" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "ERROR: Invalid token format" >&2
  exit 1
fi

# Prefer a private, root-owned runtime dir over bare /tmp: /tmp is world-
# writable, so a local user could pre-create a file at a predictable
# /tmp/sellf-upgrade-<token/instance> path ahead of time (classic /tmp
# race). /run is only writable by root by default, so if we're running as
# root (this script already assumes that — see HOME/PM2_HOME below) a
# non-root local user cannot create anything under it at all. Falls back
# to the historical /tmp layout if /run/sellf isn't writable (e.g. a
# future non-root deployment) rather than a new, unverified scheme.
# Mirrors admin-panel/src/lib/system/upgrade-paths.ts (same resolution,
# independently computed in bash — both sides agree without passing state).
# runtime-dir:start — extracted verbatim by tests/unit/scripts/upgrade-runtime-dir.test.ts
# Only attempt /run/sellf as root: `mkdir -p` is a no-op success if the dir
# already exists regardless of owner, so a non-root run could otherwise
# "succeed" against a 0700 dir a previous root-owned run left behind and
# then fail on every read/write inside it (mirrors upgrade-paths.ts).
if [ "$(id -u)" = "0" ] && mkdir -p -m 700 /run/sellf 2>/dev/null; then
  RUNTIME_DIR="/run/sellf"
else
  RUNTIME_DIR="/tmp"
fi
# runtime-dir:end

PROGRESS_FILE="${RUNTIME_DIR}/sellf-upgrade-${TOKEN}.json"
LOG_FILE="${RUNTIME_DIR}/sellf-upgrade-${TOKEN}.log"

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

log() {
  echo "[$(date -u +%H:%M:%S)] $*" >> "$LOG_FILE"
}

# ===== AUTO-DETECT INSTALL DIR =====

if [ -z "$INSTALL_DIR" ]; then
  # Derive from script location first (most reliable when called from standalone).
  # Script lives at <install>/.next/standalone/admin-panel/scripts/upgrade.sh
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  DERIVED_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd 2>/dev/null)" || true
  if [ -d "${DERIVED_DIR}/.next/standalone" ]; then
    INSTALL_DIR="$DERIVED_DIR"
  fi
fi

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

# ===== LOCK (per-instance, atomic via flock) =====
# Lock is keyed on the stack name (parent of admin-panel dir) so concurrent
# upgrades of different instances are allowed (sellf-tsa vs sellf-demo),
# but two upgrades of the same instance are blocked.
# INSTALL_DIR = /opt/stacks/sellf-tsa/admin-panel → parent = sellf-tsa

INSTANCE_NAME=$(basename "$(dirname "$INSTALL_DIR")")
LOCK_FILE="${RUNTIME_DIR}/sellf-upgrade-${INSTANCE_NAME}.lock"

cleanup_lock() {
  rm -f "$LOCK_FILE"
}
trap cleanup_lock EXIT

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  write_error "Upgrade already in progress for ${INSTANCE_NAME}"
  exit 1
fi

# ===== AUTO-DETECT PM2 NAME =====

PM2_NAME="${PM2_NAME:-}"
if [ -z "$PM2_NAME" ]; then
  # Primary: PM2 name matches the stack dir basename by convention.
  # e.g. /opt/stacks/sellf-tsa/admin-panel → parent = sellf-tsa → PM2 name = sellf-tsa
  BASENAME_NAME=$(basename "$(dirname "$INSTALL_DIR")")
  if pm2 describe "$BASENAME_NAME" &>/dev/null; then
    PM2_NAME="$BASENAME_NAME"
  fi
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

# The manifest (two lines: `version=<YYYY.M.patch>`, `sha256=<tarball hash>`) and its
# detached Ed25519 signature are published by build-release.yml next to the
# tarball. Both are required: without them the release's origin, version and
# contents cannot be verified, so the upgrade stops here.
release_asset_url() {
  echo "$RELEASE_JSON" | ASSET_NAME="$1" python3 -c "
import os, sys, json
data = json.load(sys.stdin)
for asset in data.get('assets', []):
    if asset['name'] == os.environ['ASSET_NAME']:
        print(asset['browser_download_url'])
        break
" 2>/dev/null
}

MANIFEST_URL=$(release_asset_url "sellf-build.manifest")
SIGNATURE_URL=$(release_asset_url "sellf-build.manifest.sig")

TAG_NAME=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tag_name','unknown'))" 2>/dev/null)

if [ -z "$DOWNLOAD_URL" ]; then
  write_error "No tar.gz asset found in latest release"
  exit 1
fi

if [ -z "$MANIFEST_URL" ]; then
  write_error "No sellf-build.manifest asset found in latest release — refusing to install an unverifiable archive"
  exit 1
fi

if [ -z "$SIGNATURE_URL" ]; then
  write_error "No sellf-build.manifest.sig asset found in latest release — refusing to install an unsigned release"
  exit 1
fi

# Validate tag_name is semver-like
if ! [[ "$TAG_NAME" =~ ^v?[0-9]+\.[0-9]+ ]]; then
  write_error "Invalid release tag format: $TAG_NAME"
  exit 1
fi

# Validate download URLs point to GitHub
if ! [[ "$DOWNLOAD_URL" =~ ^https://github\.com/ ]]; then
  write_error "Unexpected download URL origin"
  exit 1
fi
if ! [[ "$MANIFEST_URL" =~ ^https://github\.com/ ]]; then
  write_error "Unexpected manifest URL origin"
  exit 1
fi
if ! [[ "$SIGNATURE_URL" =~ ^https://github\.com/ ]]; then
  write_error "Unexpected signature URL origin"
  exit 1
fi

log "Latest release: $TAG_NAME"
log "Download URL: $DOWNLOAD_URL"
log "Manifest URL: $MANIFEST_URL"
log "Signature URL: $SIGNATURE_URL"

# ===== STEP 2: DOWNLOAD =====
# The small signed manifest is fetched and checked first; the archive is
# only downloaded once the manifest is verified and its version accepted.

write_progress "downloading" 10 "Downloading ${TAG_NAME} manifest..."
log "Downloading manifest..."

TMP_DIR=$(mktemp -d)
ARCHIVE="$TMP_DIR/sellf-build.tar.gz"
MANIFEST_FILE="$TMP_DIR/sellf-build.manifest"
SIGNATURE_FILE="$TMP_DIR/sellf-build.manifest.sig"

curl -fSL --max-time 30 -o "$MANIFEST_FILE" "$MANIFEST_URL" >> "$LOG_FILE" 2>&1 || {
  write_error "Failed to download release manifest"
  rm -rf "$TMP_DIR"
  exit 1
}

curl -fSL --max-time 30 -o "$SIGNATURE_FILE" "$SIGNATURE_URL" >> "$LOG_FILE" 2>&1 || {
  write_error "Failed to download release signature"
  rm -rf "$TMP_DIR"
  exit 1
}

# ===== STEP 3: VERIFY MANIFEST & VERSION =====

write_progress "checking" 12 "Verifying release signature..."
log "Verifying signature..."

# signature-verification:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# The manifest is signed in CI with the release signing key; checking it
# against RELEASE_SIGNING_PUBKEY (embedded in this installed script) proves
# the release was built by the project's CI. The manifest then binds the
# signature to the release version (version-check) and to the archive
# (checksum-validation). A release without a valid signature is never installed.
if [ ! -s "$SIGNATURE_FILE" ]; then
  write_error "Release signature missing — refusing to install"
  rm -rf "$TMP_DIR"
  exit 1
fi

if [[ "$RELEASE_SIGNING_PUBKEY" == *REPLACE_WITH_RELEASE_SIGNING_PUBLIC_KEY* ]]; then
  write_error "Release signing public key is not configured in this upgrade script — cannot verify the release"
  rm -rf "$TMP_DIR"
  exit 1
fi

PUBKEY_FILE="$TMP_DIR/release-signing-key.pub.pem"
printf '%s\n' "$RELEASE_SIGNING_PUBKEY" > "$PUBKEY_FILE"

PUBKEY_TEXT=""
if command -v openssl >/dev/null 2>&1; then
  PUBKEY_TEXT=$(openssl pkey -pubin -in "$PUBKEY_FILE" -noout -text 2>/dev/null || true)
fi
if [[ "$PUBKEY_TEXT" != *ED25519* ]]; then
  write_error "openssl on this server cannot verify Ed25519 signatures (OpenSSL 1.1.1 or newer is required) — refusing to install"
  rm -rf "$TMP_DIR"
  exit 1
fi

if ! openssl pkeyutl -verify -pubin -inkey "$PUBKEY_FILE" -rawin \
    -in "$MANIFEST_FILE" -sigfile "$SIGNATURE_FILE" >/dev/null 2>&1; then
  write_error "Release signature is not valid for the published manifest — refusing to install"
  rm -rf "$TMP_DIR"
  exit 1
fi

log "Signature OK (release signing key)"
# signature-verification:end

# manifest-parse:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# Exactly two LF-terminated lines, in this order: `version=<YYYY.M.patch>`
# (no leading v) and `sha256=<64 lowercase hex>`. Anything else is refused,
# even when signed.
MANIFEST_VERSION=""
EXPECTED_SHA=""
MANIFEST_LINES=0
while IFS= read -r manifest_line || [ -n "$manifest_line" ]; do
  MANIFEST_LINES=$((MANIFEST_LINES + 1))
  case "$MANIFEST_LINES" in
    1) if [[ "$manifest_line" == version=* ]]; then MANIFEST_VERSION="${manifest_line#version=}"; fi ;;
    2) if [[ "$manifest_line" == sha256=* ]]; then EXPECTED_SHA="${manifest_line#sha256=}"; fi ;;
  esac
done < "$MANIFEST_FILE"

if [ "$MANIFEST_LINES" -ne 2 ] \
    || ! [[ "$MANIFEST_VERSION" =~ ^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] \
    || ! [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  write_error "Malformed release manifest — refusing to install"
  rm -rf "$TMP_DIR"
  exit 1
fi

if [ "$MANIFEST_VERSION" != "${TAG_NAME#v}" ]; then
  write_error "Signed release version ${MANIFEST_VERSION} does not match the release tag ${TAG_NAME} — refusing to install"
  rm -rf "$TMP_DIR"
  exit 1
fi
# manifest-parse:end

# version-check:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# The installed version comes from version.txt (written by the release build
# and copied on every install/upgrade), falling back to package.json. Versions
# are CalVer YYYY.M.patch, compared field by field as numbers
# (2026.10.0 > 2026.9.10). Older than installed: refused. Equal: reinstalled
# through the normal install path (the admin UI's "Reinstall"); every check
# above and below still applies.
INSTALLED_VERSION=""
if [ -f "$INSTALL_DIR/version.txt" ]; then
  INSTALLED_VERSION=$(head -n 1 "$INSTALL_DIR/version.txt" | tr -d '[:space:]')
fi
if ! [[ "$INSTALLED_VERSION" =~ ^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] && [ -f "$INSTALL_DIR/package.json" ]; then
  INSTALLED_VERSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version',''))" "$INSTALL_DIR/package.json" 2>/dev/null | tr -d '[:space:]' || true)
fi
if ! [[ "$INSTALLED_VERSION" =~ ^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]]; then
  write_error "Could not determine the installed version (version.txt / package.json in ${INSTALL_DIR}) — refusing to install"
  rm -rf "$TMP_DIR"
  exit 1
fi

# Prints -1, 0 or 1 for $1 <, =, > $2 (both already validated as [v]N.N.N).
compare_calver() {
  local -a a b
  local i
  IFS=. read -r -a a <<< "${1#v}"
  IFS=. read -r -a b <<< "${2#v}"
  for i in 0 1 2; do
    if (( 10#${a[i]} < 10#${b[i]} )); then echo -1; return; fi
    if (( 10#${a[i]} > 10#${b[i]} )); then echo 1; return; fi
  done
  echo 0
}

case "$(compare_calver "$MANIFEST_VERSION" "$INSTALLED_VERSION")" in
  -1)
    write_error "Release ${MANIFEST_VERSION} is older than the installed version ${INSTALLED_VERSION} — refusing to install"
    rm -rf "$TMP_DIR"
    exit 1
    ;;
  0)
    log "Release ${MANIFEST_VERSION} is already installed; reinstalling"
    ;;
  *)
    log "Version OK: ${INSTALLED_VERSION} -> ${MANIFEST_VERSION}"
    ;;
esac
# version-check:end

# ===== STEP 4: DOWNLOAD, VALIDATE & EXTRACT ARCHIVE =====

write_progress "downloading" 15 "Downloading ${TAG_NAME}..."
log "Downloading archive..."

curl -fSL --max-time 120 -o "$ARCHIVE" "$DOWNLOAD_URL" >> "$LOG_FILE" 2>&1 || {
  write_error "Failed to download release archive"
  rm -rf "$TMP_DIR"
  exit 1
}

log "Download complete: $(du -h "$ARCHIVE" | cut -f1)"

write_progress "extracting" 25 "Verifying archive integrity..."
log "Verifying checksum..."

# checksum-validation:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# EXPECTED_SHA comes from the signed manifest (manifest-parse).
ACTUAL_SHA=$(sha256sum "$ARCHIVE" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  write_error "Security: checksum mismatch — downloaded archive does not match the signed manifest"
  rm -rf "$TMP_DIR"
  exit 1
fi

log "Checksum OK: $ACTUAL_SHA"
# checksum-validation:end

# tar-validation:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# Security: validate every archive entry BEFORE extraction. Reject anything
# that isn't a plain file or directory (symlinks, hardlinks, device nodes,
# FIFOs — `tar -tzvf`'s leading type character) and any path that is
# absolute or attempts to traverse outside the extraction root. A check
# performed after `tar -xzf` has already run is too late: the write already
# happened.
write_progress "extracting" 28 "Validating archive contents..."
log "Validating archive entries..."

if ! TAR_TZVF_OUTPUT=$(tar -tzvf "$ARCHIVE" 2>/dev/null); then
  write_error "Security: unable to read archive contents"
  rm -rf "$TMP_DIR"
  exit 1
fi
if [ -z "$TAR_TZVF_OUTPUT" ]; then
  write_error "Security: archive contains no entries"
  rm -rf "$TMP_DIR"
  exit 1
fi

while IFS= read -r tar_line; do
  entry_type="${tar_line:0:1}"
  case "$entry_type" in
    -|d) ;; # regular file / directory — OK
    *)
      write_error "Security: archive contains a non-regular entry (type '${entry_type}')"
      rm -rf "$TMP_DIR"
      exit 1
      ;;
  esac
done <<< "$TAR_TZVF_OUTPUT"

if ! TAR_TZF_OUTPUT=$(tar -tzf "$ARCHIVE" 2>/dev/null); then
  write_error "Security: unable to read archive contents"
  rm -rf "$TMP_DIR"
  exit 1
fi
if [ -z "$TAR_TZF_OUTPUT" ]; then
  write_error "Security: archive contains no entries"
  rm -rf "$TMP_DIR"
  exit 1
fi

while IFS= read -r entry_path; do
  case "$entry_path" in
    /*|*/../*|../*|..|*/..)
      write_error "Security: archive contains an unsafe path (${entry_path})"
      rm -rf "$TMP_DIR"
      exit 1
      ;;
  esac
done <<< "$TAR_TZF_OUTPUT"
# tar-validation:end

log "Archive entries validated OK"

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

log "Archive validated OK"

# ===== STEP 5: BACKUP =====

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

# ===== STEP 6: STOP PM2 =====

write_progress "stopping" 55 "Stopping application..."
log "Stopping PM2 process: $PM2_NAME"

pm2 stop "$PM2_NAME" >> "$LOG_FILE" 2>&1 || log "WARNING: PM2 stop failed (process may not be running)"

# ===== STEP 7: SWAP FILES =====

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
cp "$EXTRACT_DIR/version.txt" "$INSTALL_DIR/" 2>/dev/null || true

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

# Ensure CHECKOUT_BINDING_SECRET exists (production refuses to boot without
# it). Self-hosters upgrading from an older version may not have generated
# one yet — auto-create on first upgrade so the next boot does not fail
# closed. Existing values are preserved so in-flight sessions stay valid.
if [ -f "$INSTALL_DIR/.env.local" ] && ! grep -q "^CHECKOUT_BINDING_SECRET=" "$INSTALL_DIR/.env.local"; then
  printf "CHECKOUT_BINDING_SECRET=%s\n" "$(openssl rand -base64 32)" >> "$INSTALL_DIR/.env.local"
  echo "  → generated CHECKOUT_BINDING_SECRET (rotate via incident response only)"
fi

# Ensure LOGINWALL_SECRET exists. Required by the per-product login-wall
# handoff token. Rotating it just invalidates in-flight tokens — visitors
# transparently get a fresh one via /loginwall/protect.
if [ -f "$INSTALL_DIR/.env.local" ] && ! grep -q "^LOGINWALL_SECRET=" "$INSTALL_DIR/.env.local"; then
  printf "LOGINWALL_SECRET=%s\n" "$(openssl rand -hex 32)" >> "$INSTALL_DIR/.env.local"
  echo "  → generated LOGINWALL_SECRET"
fi

# Ensure CRON_SECRET exists. Without it /api/cron rejects every request and
# scheduled jobs (access-expired webhooks, webhook log cleanup) do not run.
# Auto-generate so the endpoint is callable by an authorized scheduler the
# moment the operator wires one up.
if [ -f "$INSTALL_DIR/.env.local" ] && ! grep -q "^CRON_SECRET=" "$INSTALL_DIR/.env.local"; then
  printf "CRON_SECRET=%s\n" "$(openssl rand -base64 32)" >> "$INSTALL_DIR/.env.local"
  echo "  → generated CRON_SECRET (point your scheduler at /api/cron with Authorization: Bearer <value>)"
fi

# Ensure TRUSTED_PROXY=true is set. Production startup refuses to boot
# without it; rate limiting also degrades to a shared "unknown" bucket for
# every request when it is missing. Self-hosters using upgrade.sh ship
# Sellf behind a reverse proxy (Caddy/nginx), so true is the correct
# default for this deploy path.
if [ -f "$INSTALL_DIR/.env.local" ] && ! grep -q "^TRUSTED_PROXY=" "$INSTALL_DIR/.env.local"; then
  printf "TRUSTED_PROXY=true\n" >> "$INSTALL_DIR/.env.local"
  echo "  → enabled TRUSTED_PROXY (read client IP from last X-Forwarded-For hop)"
fi

if [ -f "$INSTALL_DIR/.env.local" ] && ! grep -q "^SELLF_PM2_MAX_MEMORY=" "$INSTALL_DIR/.env.local"; then
  printf "SELLF_PM2_MAX_MEMORY=512M\n" >> "$INSTALL_DIR/.env.local"
  printf "SELLF_NODE_MAX_OLD_SPACE=400\n" >> "$INSTALL_DIR/.env.local"
  echo "  → set SELLF_PM2_MAX_MEMORY=512M + SELLF_NODE_MAX_OLD_SPACE=400 (raise to 1G/800 on prod)"
fi

# Copy .env.local into standalone dir
STANDALONE_DIR="$INSTALL_DIR/.next/standalone/admin-panel"
if [ -d "$STANDALONE_DIR" ] && [ -f "$INSTALL_DIR/.env.local" ]; then
  cp "$INSTALL_DIR/.env.local" "$STANDALONE_DIR/.env.local"
fi

# Link static assets and public into standalone dir (Next.js standalone does not copy them)
if [ -d "$STANDALONE_DIR" ]; then
  [ -d "$INSTALL_DIR/.next/static" ] && ln -sfn "$INSTALL_DIR/.next/static" "$STANDALONE_DIR/.next/static" 2>/dev/null || true
  [ -d "$INSTALL_DIR/public" ]       && ln -sfn "$INSTALL_DIR/public"       "$STANDALONE_DIR/public"       2>/dev/null || true
fi

log "Files swapped"

# ===== STEP 8: RUN MIGRATIONS =====

write_progress "migrating" 75 "Running database migrations..."
log "Running migrations..."
MIGRATION_ERRORS=0

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
      MIGRATION_SKIPPED=0

      for migration_file in "$INSTALL_DIR/supabase/migrations/"*.sql; do
        [ -f "$migration_file" ] || continue
        [ -d "$migration_file" ] && continue
        VERSION=$(basename "$migration_file" .sql)

        # The database records timestamps independently of migration names.
        if jq -e --arg v "${VERSION%%_*}" \
          'any(.[]; (.version | split("_")[0]) == $v)' <<< "$APPLIED" >/dev/null 2>&1; then
          MIGRATION_SKIPPED=$((MIGRATION_SKIPPED + 1))
          continue
        fi

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

        if ! OUTCOME=$(jq -er -s '
          if length != 1 then error("Expected one result")
          else .[0] |
            if type != "object" then error("Expected an object")
            elif (.success | type) != "boolean" then error("Expected success boolean")
            elif has("skipped") and (.skipped | type) != "boolean" then error("Expected skipped boolean")
            elif .success == false then "failed"
            elif .skipped == true then "already_applied"
            else "applied"
            end
          end' <<< "$RESULT" 2>/dev/null); then
          log "WARNING: Migration $VERSION failed: Invalid migration RPC response"
          MIGRATION_ERRORS=$((MIGRATION_ERRORS + 1))
          continue
        fi

        if [ "$OUTCOME" = "failed" ]; then
          MESSAGE=$(jq -r '.message | if type == "string" then gsub("[\\r\\n]"; " ") else "Migration RPC reported failure" end' <<< "$RESULT")
          log "WARNING: Migration $VERSION failed: $MESSAGE"
          MIGRATION_ERRORS=$((MIGRATION_ERRORS + 1))
        elif [ "$OUTCOME" = "already_applied" ]; then
          log "Migration $VERSION: already applied"
          MIGRATION_SKIPPED=$((MIGRATION_SKIPPED + 1))
        else
          log "Migration $VERSION: $RESULT"
          MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
        fi
      done

      log "Migrations complete: $MIGRATION_COUNT applied, $MIGRATION_SKIPPED already applied, $MIGRATION_ERRORS errors"
    fi
  fi
else
  log "Skipping migrations (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)"
fi

# ===== STEP 9: START PM2 =====

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
# Load .env.local into shell so PM2 captures actual values.
# dotenv in server.js won't override vars already set by PM2, so we pre-load them here.
if [ -f "$INSTALL_DIR/.env.local" ]; then
  set -o allexport
  # shellcheck source=/dev/null
  source "$INSTALL_DIR/.env.local"
  set +o allexport
fi
MEM_LIMIT="${SELLF_PM2_MAX_MEMORY:-512M}"
OLD_SPACE="${SELLF_NODE_MAX_OLD_SPACE:-400}"
# ::: loopback only — app runs behind Caddy, never exposed directly
PORT="${PORT}" HOSTNAME="${HOSTNAME:-::}" pm2 start "$(basename "$SERVER_JS")" --name "$PM2_NAME" \
  --max-memory-restart "${MEM_LIMIT}" \
  --node-args="--max-old-space-size=${OLD_SPACE}" >> "$LOG_FILE" 2>&1

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
  if [ "$MIGRATION_ERRORS" -gt 0 ]; then
    write_error "Upgrade to ${TAG_NAME} finished with $MIGRATION_ERRORS migration errors. Check upgrade logs."
    log "WARNING: Upgrade finished with $MIGRATION_ERRORS migration errors. Version: $TAG_NAME"
  else
    write_progress "done" 100 "Upgrade to ${TAG_NAME} completed successfully!"
    log "Upgrade complete! Version: $TAG_NAME"
  fi
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
    if [ -f "$INSTALL_DIR/.env.local" ]; then
      set -o allexport
      # shellcheck source=/dev/null
      source "$INSTALL_DIR/.env.local"
      set +o allexport
    fi
    PORT="${PORT}" HOSTNAME="${HOSTNAME:-::}" pm2 start "$(basename "$OLD_SERVER_JS")" --name "$PM2_NAME" \
      --max-memory-restart "${MEM_LIMIT:-512M}" \
      --node-args="--max-old-space-size=${OLD_SPACE:-400}" >> "$LOG_FILE" 2>&1 || true
    pm2 save >> "$LOG_FILE" 2>&1 || true
  fi

  write_error "Upgrade failed: health check timeout. Rolled back to previous version." true
  rm -rf "$TMP_DIR"
  exit 1
fi

# ===== FIREWALL CHECK =====
# Sellf binds to HOSTNAME=:: — a dual-stack socket that accepts both IPv6
# and (via the kernel's IPv4-mapped addresses, on by default) IPv4 traffic.
# Warn if EITHER iptables (v4) or ip6tables (v6) INPUT policy is not DROP —
# checking only one stack leaves the other one silently open.
if command -v ip6tables >/dev/null 2>&1; then
  FW_POLICY_V6=$(ip6tables -S INPUT 2>/dev/null | grep '^-P INPUT' | awk '{print $3}')
  if [ "$FW_POLICY_V6" != "DROP" ]; then
    log "WARN: ip6tables INPUT policy = ${FW_POLICY_V6:-UNKNOWN}. Port ${PORT} may be exposed directly over IPv6. Run: ./local/setup-firewall.sh <ssh_alias>"
  fi
fi
if command -v iptables >/dev/null 2>&1; then
  FW_POLICY_V4=$(iptables -S INPUT 2>/dev/null | grep '^-P INPUT' | awk '{print $3}')
  if [ "$FW_POLICY_V4" != "DROP" ]; then
    log "WARN: iptables INPUT policy = ${FW_POLICY_V4:-UNKNOWN}. Port ${PORT} may be exposed directly over IPv4. Run: ./local/setup-firewall.sh <ssh_alias>"
  fi
fi

# ===== CLEANUP =====

rm -rf "$TMP_DIR"
log "Temp files cleaned up. Backup preserved at $BACKUP_DIR"

if [ "$MIGRATION_ERRORS" -gt 0 ]; then
  exit 1
fi

}
main "$@"
