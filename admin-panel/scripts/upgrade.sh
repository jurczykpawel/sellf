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

# Version 1 is the unversioned updater shipped through 2026.10.6.
UPDATER_VERSION=2
# CI emits a legacy manifest only while version-1 updaters are supported.
MIN_UPDATER_VERSION=1
# sellf-upgrade-stage2:1

# Parse the main body before executing. Stage 2 runs from the private extraction;
# the installed script is replaced atomically so its open inode is preserved.
# A function alone cannot protect the reader's offset after main() returns.
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

# json_string <value> [max characters, default 300]: JSON string for progress
# files, control characters dropped.
json_string() {
  local value
  value=$(printf '%s' "$1" | tr -d '\000-\037' | cut -c1-"${2:-300}" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '"%s"' "$value"
}

# write_failure <code> <message> [<detail key> <detail value>]...
# The panel localizes known codes from the details and shows the message otherwise.
# http_status is written as a number, other details as strings. A "rollback"
# detail (any value) marks that the previous code was restored.
write_failure() {
  local code="$1" message="$2" details="" rollback=false key value
  shift 2
  while [ "$#" -ge 2 ]; do
    key="$1" value="$2"
    shift 2
    if [ "$key" = rollback ]; then rollback=true; continue; fi
    [ -n "$value" ] || continue
    if [ "$key" = http_status ] && [[ "$value" =~ ^[0-9]{3}$ ]]; then
      details="${details:+$details,}\"$key\":$value"
    else
      details="${details:+$details,}\"$key\":$(json_string "$value")"
    fi
  done
  printf '{"step":"failed","progress":-1,"code":"%s","message":%s,"details":{%s},"rollback":%s,"timestamp":"%s"}\n' \
    "$code" "$(json_string "$message" 2000)" "$details" "$rollback" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PROGRESS_FILE"
}

# installed-version:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# The installed version comes from version.txt (written by the release build
# and copied on every install/upgrade), falling back to package.json. Prints
# nothing when neither holds a CalVer version.
read_installed_version() {
  local version=""
  if [ -f "$INSTALL_DIR/version.txt" ]; then
    version=$(head -n 1 "$INSTALL_DIR/version.txt" | tr -d '[:space:]')
  fi
  if ! [[ "$version" =~ ^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] && [ -f "$INSTALL_DIR/package.json" ]; then
    version=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version',''))" "$INSTALL_DIR/package.json" 2>/dev/null | tr -d '[:space:]' || true)
  fi
  if [[ "$version" =~ ^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]]; then
    printf '%s\n' "$version"
  fi
}
# installed-version:end

# failure-report:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# fail_unchanged <code> <message> [<detail key> <detail value>]...
# Stops an attempt before backup, PM2 or database changes. A "note" detail is
# appended to the message after the unchanged-version sentence.
fail_unchanged() {
  local code="$1" message="$2" installed note="" key value
  local -a details=()
  shift 2
  while [ "$#" -ge 2 ]; do
    key="$1" value="$2"
    shift 2
    if [ "$key" = note ]; then note="$value"; else details+=("$key" "$value"); fi
  done
  installed=$(read_installed_version)
  if [ -n "$installed" ]; then
    message="$message Nothing was changed; the shop is still running version ${installed#v}."
  else
    message="$message Nothing was changed; the shop is still running the version installed before this attempt."
  fi
  message="$message${note:+ $note}"
  log "ERROR: $message"
  write_failure "$code" "$message" installed_version "${installed#v}" ${details[@]+"${details[@]}"}
  rm -rf "${TMP_DIR:-}"
  exit 1
}
# failure-report:end

# Stage 2 is this same script, executed FROM the verified private extraction.
# All context is passed as argv; no downloaded shell state is sourced. Descriptor
# 200 survives exec, keeping the original instance lock held across both stages.
if [ "${3:-}" = "--apply-verified" ]; then
  TMP_DIR="${4:?Missing verified extraction}"
  TAG_NAME="${5:?Missing release tag}"
  PM2_BIN="${6:?Missing PM2 executable}"
  PM2_NAME="${7:?Missing PM2 name}"
  PROGRESS_FILE="${8:?Missing progress path}"
  LOG_FILE="${9:?Missing log path}"
  LOCK_FILE="${10:?Missing lock path}"
  EXTRACT_DIR="$TMP_DIR/extracted"
  if ! flock -n 200; then
    write_error "Missing inherited updater lock — stage 2 cannot run independently"
    exit 1
  fi
  trap 'rm -rf "$TMP_DIR"; rm -f "$LOCK_FILE"' EXIT
  log "Inherited updater lock; running downloaded stage 2"
else

# ===== EXECUTABLE PREFLIGHT =====
# Resolve once before any download or installation changes. systemd services
# may omit the Bun/npm global bin directories from their minimal PATH.
resolve_pm2() {
  local candidate node_path global_dir
  candidate=$(command -v pm2 || true)
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi
  node_path=$(command -v node || true)
  for candidate in "$HOME/.bun/bin/pm2" /usr/local/bin/pm2 /usr/bin/pm2 \
    "${node_path:+$(dirname "$node_path")/pm2}"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  if command -v npm >/dev/null 2>&1; then
    # npm 9+ removed `npm bin`; prefix/bin is its Unix global bin directory.
    global_dir=$(npm prefix -g 2>/dev/null || true)
    candidate="${global_dir}/bin/pm2"
    if [ -n "$global_dir" ] && [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi
  if command -v bun >/dev/null 2>&1; then
    global_dir=$(bun pm bin -g 2>/dev/null || true)
    candidate="${global_dir}/pm2"
    if [ -n "$global_dir" ] && [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi
  return 1
}

PM2_BIN=$(resolve_pm2) || {
  write_error "PM2 executable not found. Install PM2 or fix the server PATH before upgrading."
  log "ERROR: PM2 executable not found; installation unchanged"
  exit 1
}
log "PM2_BIN: $PM2_BIN"

# PM2's JS executable uses /usr/bin/env node, including when installed by Bun.
# Bun itself is only an optional discovery tool; no later step requires it.
NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  for candidate in "$HOME/.bun/bin/node" /usr/local/bin/node /usr/bin/node; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [ -z "$NODE_BIN" ] || ! "$NODE_BIN" --version >/dev/null 2>&1; then
  write_error "Node executable not found or unusable. Install Node before upgrading."
  log "ERROR: Node executable not found or unusable; installation unchanged"
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):${PATH:-/usr/local/bin:/usr/bin:/bin}"
if ! "$PM2_BIN" --version >> "$LOG_FILE" 2>&1; then
  write_error "PM2 executable could not run. Check the upgrade log before retrying."
  log "ERROR: PM2 executable could not run; installation unchanged"
  exit 1
fi

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
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  fail_unchanged upgrade_running "Another update of ${INSTANCE_NAME} is already running." \
    note "Wait for it to finish, then check again."
fi
trap cleanup_lock EXIT

# ===== AUTO-DETECT PM2 NAME =====

PM2_NAME="${PM2_NAME:-}"
if [ -z "$PM2_NAME" ]; then
  # Primary: PM2 name matches the stack dir basename by convention.
  # e.g. /opt/stacks/sellf-tsa/admin-panel → parent = sellf-tsa → PM2 name = sellf-tsa
  BASENAME_NAME=$(basename "$(dirname "$INSTALL_DIR")")
  if "$PM2_BIN" describe "$BASENAME_NAME" &>/dev/null; then
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
log "Looking up the latest release on github.com..."

TMP_DIR=$(mktemp -d)
chmod 700 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"; cleanup_lock' EXIT
ARCHIVE="$TMP_DIR/sellf-build.tar.gz"
MANIFEST_FILE="$TMP_DIR/sellf-build.manifest"
SIGNATURE_FILE="$TMP_DIR/sellf-build.manifest.sig"

# github-release:start
# Only github.com pages and release files are used. api.github.com allows 60
# requests per hour per address, and servers behind a shared NAT exhaust it.
if ! [[ "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail_unchanged release_lookup_invalid "GITHUB_REPO must look like owner/repository."
fi
GITHUB_BASE="https://github.com/${GITHUB_REPO}"
GITHUB_HEADERS="$TMP_DIR/github-headers"

# github_get <url> <output file> <max seconds> [follow]
# Sets GITHUB_STATUS (000 = no complete response) and GITHUB_LOCATION.
github_get() {
  local result rc=0
  : > "$GITHUB_HEADERS"
  result=$(curl -sS ${4:+-L --proto-redir =https} --max-time "$3" -D "$GITHUB_HEADERS" -o "$2" \
    -w '%{http_code} %{redirect_url}' "$1" 2>>"$LOG_FILE") || rc=$?
  GITHUB_STATUS="${result%% *}"
  GITHUB_LOCATION="${result#* }"
  [[ "$GITHUB_STATUS" =~ ^[0-9]{3}$ ]] || GITHUB_STATUS=000
  # An interrupted transfer can follow a 200 status line.
  if [ "$rc" -ne 0 ] && [[ "$GITHUB_STATUS" == 2?? ]]; then GITHUB_STATUS=000; fi
  log "GET $1 -> HTTP $GITHUB_STATUS"
  [[ "$GITHUB_STATUS" == 2?? ]]
}

# Last value of a response header, case-insensitive.
github_header() {
  tr -d '\r' < "$GITHUB_HEADERS" | grep -i "^$1:" | tail -n 1 | cut -d: -f2- \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' || true
}

# The "message" field of a JSON error body, if there is one.
github_json_message() {
  [ -s "$1" ] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r 'if type == "object" and (.message | type) == "string" then .message else empty end' < "$1" 2>/dev/null \
      | tr -d '\000-\037' | cut -c1-200 || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -c 'import json,sys
try:
    m = json.load(open(sys.argv[1])).get("message")
    print(m if isinstance(m, str) else "")
except Exception:
    pass' "$1" 2>/dev/null | tr -d '\000-\037' | cut -c1-200 || true
  fi
}

utc_time() {
  date -u -d "@$1" "$2" 2>/dev/null || date -u -r "$1" "$2" 2>/dev/null || true
}

# github_stop <what was requested> <asset name or empty> <response body file>
github_stop() {
  local what="$1" asset="$2" body="$3" code message github_message retry_after reset retry_epoch="" retry_at="" note=""
  github_message=$(github_json_message "$body")
  retry_after=$(github_header retry-after)
  reset=$(github_header x-ratelimit-reset)
  if [[ "$retry_after" =~ ^[0-9]{1,6}$ ]]; then
    retry_epoch=$(( $(date -u +%s) + 10#$retry_after ))
  elif [[ "$reset" =~ ^[0-9]{9,11}$ ]]; then
    retry_epoch="$reset"
  fi
  if [ -n "$retry_epoch" ]; then
    retry_at=$(utc_time "$retry_epoch" +%Y-%m-%dT%H:%M:%SZ)
    note="Try again after $(utc_time "$retry_epoch" '+%Y-%m-%d %H:%M') UTC."
  fi
  case "$GITHUB_STATUS" in
    000)
      code=github_unreachable
      message="Could not connect to GitHub to download ${what}${asset:+ $asset} (network error or timeout)." ;;
    404)
      code=release_asset_missing
      message="Release ${TAG_NAME} on GitHub does not contain ${what} ${asset} (HTTP 404)." ;;
    *)
      code=github_http
      message="GitHub refused to send ${what}${asset:+ $asset}: HTTP ${GITHUB_STATUS}${github_message:+ ($github_message)}." ;;
  esac
  if [ -z "$note" ] && [ "$code" != release_asset_missing ]; then note="Try again in a few minutes."; fi
  local status_detail="$GITHUB_STATUS"
  [ "$status_detail" != 000 ] || status_detail=""
  fail_unchanged "$code" "$message" http_status "$status_detail" github_message "$github_message" \
    retry_at "$retry_at" asset "$asset" note "$note"
}

# github.com answers /releases/latest with a redirect to the tag page.
TAG_NAME=""
github_get "$GITHUB_BASE/releases/latest" "$TMP_DIR/latest-response" 30 || true
case "$GITHUB_STATUS" in
  301|302|303|307|308) ;;
  2??|404)
    fail_unchanged release_lookup_invalid "GitHub did not report a published release for ${GITHUB_REPO}." \
      http_status "$GITHUB_STATUS" note "Try again in a few minutes." ;;
  *) github_stop "the latest release information" "" "$TMP_DIR/latest-response" ;;
esac
TAG_PREFIX="${GITHUB_BASE}/releases/tag/"
if [[ "$GITHUB_LOCATION" == "$TAG_PREFIX"* ]]; then TAG_NAME="${GITHUB_LOCATION#"$TAG_PREFIX"}"; fi
if ! [[ "$TAG_NAME" =~ ^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]]; then
  fail_unchanged release_lookup_invalid "GitHub reported an unexpected latest release address." \
    note "Try again in a few minutes."
fi
RELEASE_DOWNLOAD="${GITHUB_BASE}/releases/download/${TAG_NAME}"
log "Latest release: $TAG_NAME"

# ===== STEP 2: DOWNLOAD =====
# The small signed manifest is fetched and checked first; the archive is
# only downloaded once the manifest is verified and its version accepted.

write_progress "downloading" 10 "Downloading ${TAG_NAME} manifest..."

# Keep the two-line legacy asset for 10.6; new bootstraps prefer the signed
# extended manifest. A release with only one v2 file never falls back.
MANIFEST_V2=true
if github_get "$RELEASE_DOWNLOAD/sellf-build.v2.manifest" "$MANIFEST_FILE" 30 follow; then
  github_get "$RELEASE_DOWNLOAD/sellf-build.v2.manifest.sig" "$SIGNATURE_FILE" 30 follow \
    || github_stop "the release signature" sellf-build.v2.manifest.sig "$SIGNATURE_FILE"
elif [ "$GITHUB_STATUS" = 404 ]; then
  if github_get "$RELEASE_DOWNLOAD/sellf-build.v2.manifest.sig" "$SIGNATURE_FILE" 30 follow; then
    GITHUB_STATUS=404
    github_stop "the release manifest" sellf-build.v2.manifest /dev/null
  elif [ "$GITHUB_STATUS" != 404 ]; then
    github_stop "the release signature" sellf-build.v2.manifest.sig "$SIGNATURE_FILE"
  fi
  MANIFEST_V2=false
  github_get "$RELEASE_DOWNLOAD/sellf-build.manifest" "$MANIFEST_FILE" 30 follow \
    || github_stop "the release manifest" sellf-build.manifest "$MANIFEST_FILE"
  github_get "$RELEASE_DOWNLOAD/sellf-build.manifest.sig" "$SIGNATURE_FILE" 30 follow \
    || github_stop "the release signature" sellf-build.manifest.sig "$SIGNATURE_FILE"
else
  github_stop "the release manifest" sellf-build.v2.manifest "$MANIFEST_FILE"
fi
# github-release:end

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
  fail_unchanged signature_invalid "Release signature missing — refusing to install."
fi

if [[ "$RELEASE_SIGNING_PUBKEY" == *REPLACE_WITH_RELEASE_SIGNING_PUBLIC_KEY* ]]; then
  fail_unchanged updater_misconfigured "Release signing public key is not configured in this upgrade script — cannot verify the release."
fi

PUBKEY_FILE="$TMP_DIR/release-signing-key.pub.pem"
printf '%s\n' "$RELEASE_SIGNING_PUBKEY" > "$PUBKEY_FILE"

PUBKEY_TEXT=""
if command -v openssl >/dev/null 2>&1; then
  PUBKEY_TEXT=$(openssl pkey -pubin -in "$PUBKEY_FILE" -noout -text 2>/dev/null || true)
fi
if [[ "$PUBKEY_TEXT" != *ED25519* ]]; then
  fail_unchanged openssl_unsupported "openssl on this server cannot verify Ed25519 signatures (OpenSSL 1.1.1 or newer is required) — refusing to install."
fi

if ! openssl pkeyutl -verify -pubin -inkey "$PUBKEY_FILE" -rawin \
    -in "$MANIFEST_FILE" -sigfile "$SIGNATURE_FILE" >/dev/null 2>&1; then
  fail_unchanged signature_invalid "Release signature is not valid for the published manifest — refusing to install."
fi

log "Signature OK (release signing key)"
# signature-verification:end

# manifest-parse:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# Legacy: two lines. V2: the same lines plus min_updater_version=<integer>.
# Unknown, duplicate and reordered fields are rejected, even when signed.
MANIFEST_VERSION=""
EXPECTED_SHA=""
REQUIRED_UPDATER_VERSION=1
MANIFEST_LINES=0
while IFS= read -r manifest_line || [ -n "$manifest_line" ]; do
  MANIFEST_LINES=$((MANIFEST_LINES + 1))
  case "$MANIFEST_LINES" in
    1) if [[ "$manifest_line" == version=* ]]; then MANIFEST_VERSION="${manifest_line#version=}"; fi ;;
    2) if [[ "$manifest_line" == sha256=* ]]; then EXPECTED_SHA="${manifest_line#sha256=}"; fi ;;
    3) REQUIRED_UPDATER_VERSION="${manifest_line#min_updater_version=}"
       [[ "$manifest_line" == min_updater_version=* ]] || REQUIRED_UPDATER_VERSION="invalid" ;;
  esac
done < "$MANIFEST_FILE"

EXPECTED_MANIFEST_LINES=2
if [ "${MANIFEST_V2:-false}" = true ]; then EXPECTED_MANIFEST_LINES=3; fi
if [ "$MANIFEST_LINES" -ne "$EXPECTED_MANIFEST_LINES" ] \
    || ! [[ "$REQUIRED_UPDATER_VERSION" =~ ^[1-9][0-9]{0,8}$ ]] \
    || ! [[ "$MANIFEST_VERSION" =~ ^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] \
    || ! [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  fail_unchanged manifest_invalid "Malformed release manifest — refusing to install."
fi

if [ "$MANIFEST_VERSION" != "${TAG_NAME#v}" ]; then
  fail_unchanged manifest_invalid "Signed release version ${MANIFEST_VERSION} does not match the release tag ${TAG_NAME} — refusing to install."
fi
# An old bootstrap must refuse BEFORE downloading/executing any release code.
if [ "$REQUIRED_UPDATER_VERSION" -gt "${UPDATER_VERSION:-1}" ]; then
  fail_unchanged updater_too_old "This release requires updater $REQUIRED_UPDATER_VERSION (installed: ${UPDATER_VERSION:-1}). Update Sellf through Stackpilot: ./local/deploy.sh sellf --ssh=<server> --update."
fi
# manifest-parse:end

# version-check:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# Versions are CalVer YYYY.M.patch, compared field by field as numbers
# (2026.10.0 > 2026.9.10). Older than installed: refused. Equal: reinstalled
# through the normal install path (the admin UI's "Reinstall"); every check
# above and below still applies.
INSTALLED_VERSION=$(read_installed_version)
if [ -z "$INSTALLED_VERSION" ]; then
  fail_unchanged installed_version_unknown "Could not determine the installed version (version.txt / package.json in ${INSTALL_DIR}) — refusing to install."
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
    fail_unchanged release_older "Release ${MANIFEST_VERSION} is older than the installed version ${INSTALLED_VERSION} — refusing to install."
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

github_get "$RELEASE_DOWNLOAD/sellf-build.tar.gz" "$ARCHIVE" 120 follow \
  || github_stop "the release archive" sellf-build.tar.gz /dev/null

log "Download complete: $(du -h "$ARCHIVE" | cut -f1)"

write_progress "extracting" 25 "Verifying archive integrity..."
log "Verifying checksum..."

# checksum-validation:start — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts
# EXPECTED_SHA comes from the signed manifest (manifest-parse).
ACTUAL_SHA=$(sha256sum "$ARCHIVE" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  fail_unchanged checksum_mismatch "Security: checksum mismatch — downloaded archive does not match the signed manifest."
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
  fail_unchanged archive_invalid "Security: unable to read archive contents."
fi
if [ -z "$TAR_TZVF_OUTPUT" ]; then
  fail_unchanged archive_invalid "Security: archive contains no entries."
fi

while IFS= read -r tar_line; do
  entry_type="${tar_line:0:1}"
  case "$entry_type" in
    -|d) ;; # regular file / directory — OK
    *)
      fail_unchanged archive_invalid "Security: archive contains a non-regular entry (type '${entry_type}')."
      ;;
  esac
done <<< "$TAR_TZVF_OUTPUT"

if ! TAR_TZF_OUTPUT=$(tar -tzf "$ARCHIVE" 2>/dev/null); then
  fail_unchanged archive_invalid "Security: unable to read archive contents."
fi
if [ -z "$TAR_TZF_OUTPUT" ]; then
  fail_unchanged archive_invalid "Security: archive contains no entries."
fi

while IFS= read -r entry_path; do
  case "$entry_path" in
    /*|*/../*|../*|..|*/..)
      fail_unchanged archive_invalid "Security: archive contains an unsafe path (${entry_path})."
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
  fail_unchanged archive_invalid "Failed to extract archive."
}

# Validate archive structure
if [ ! -d "$EXTRACT_DIR/.next/standalone" ]; then
  fail_unchanged archive_invalid "Invalid archive: missing .next/standalone/."
fi

log "Archive validated OK"

# Only verified regular files can reach this point (signature, checksum and
# archive validation above). Old packages lack the stage-2 protocol marker;
# reinstalling those packages retains this installed script's apply logic.
DOWNLOADED_UPDATER="$EXTRACT_DIR/scripts/upgrade.sh"
if [ -f "$DOWNLOADED_UPDATER" ] && grep -qx '# sellf-upgrade-stage2:1' "$DOWNLOADED_UPDATER"; then
  log "Handing verified release to downloaded stage 2"
  exec bash "$DOWNLOADED_UPDATER" "$TOKEN" "$INSTALL_DIR" --apply-verified \
    "$TMP_DIR" "$TAG_NAME" "$PM2_BIN" "$PM2_NAME" "$PROGRESS_FILE" "$LOG_FILE" "$LOCK_FILE"
fi
log "Release has no stage 2; using installed updater fallback"
fi

# ===== STEP 4b: MIGRATION PREFLIGHT =====
# Only the release's own migration files are applied. An ambiguous set stops
# here, before the installation, the running process or the database change.

# Keep HTTP error bodies, including non-JSON responses, in the private upgrade log.
# Neither SQL nor JSON is ever passed as a large process argument.
migration_rpc() {
  local endpoint="$1" payload="$2" http_status
  local response_file="$TMP_DIR/migration-response.json"
  : > "$response_file"
  if ! http_status=$(curl -sS "${SUPABASE_URL}/rest/v1/rpc/$endpoint" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    --data-binary "$payload" -o "$response_file" -w '%{http_code}' 2>>"$LOG_FILE"); then
    log "ERROR: $endpoint transport failed (HTTP ${http_status:-unknown})"
    cat "$response_file" >> "$LOG_FILE"
    return 1
  fi
  if [ "$http_status" != "200" ]; then
    log "ERROR: $endpoint HTTP $http_status; full response:"
    cat "$response_file" >> "$LOG_FILE"
    return 1
  fi
  cat "$response_file"
}

preflight_stop() {
  fail_unchanged migration_preflight "$1"
}

if [ ! -d "$EXTRACT_DIR/supabase/migrations" ]; then
  preflight_stop "Invalid archive: missing supabase/migrations/. Database untouched."
fi
RELEASE_MIGRATIONS=$(find "$EXTRACT_DIR/supabase/migrations" -mindepth 1 -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} .sql \; | LC_ALL=C sort)

DUPLICATE_TIMESTAMP=$(printf '%s\n' "$RELEASE_MIGRATIONS" | cut -d_ -f1 | LC_ALL=C sort | uniq -d | head -n 1)
if [ -n "$DUPLICATE_TIMESTAMP" ]; then
  preflight_stop "Migration timestamp $DUPLICATE_TIMESTAMP is used by more than one file in this release. Database untouched."
fi

# Read Supabase connection info from .env.local
SUPABASE_URL=$(grep -E '^SUPABASE_URL=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2- || true)
SERVICE_KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2- || true)

# Read-only status lookup. With a configured database the registry must be
# readable before anything changes; without one the migration step reports it.
APPLIED_STATE=unconfigured
if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ]; then
  if ! command -v jq &>/dev/null; then
    preflight_stop "jq is not installed (apt-get install jq). Database untouched."
  fi
  if ! APPLIED=$(migration_rpc get_migration_status '{}'); then
    log "Run 'deploy.sh sellf --update' once to bootstrap migration system"
    preflight_stop "Migration status could not be read. Check upgrade logs. Database untouched."
  fi
  if ! jq -e -s 'length == 1 and (.[0] | type == "array" and all(.[]; type == "object" and (.version | type == "string")))' \
    <<< "$APPLIED" >/dev/null 2>&1; then
    log "Invalid migration status response; full response:"
    printf '%s\n' "$APPLIED" >> "$LOG_FILE"
    preflight_stop "Migration status response is invalid. Check upgrade logs. Database untouched."
  fi
  APPLIED_STATE=ok
  # The registry keys migrations by timestamp; a different recorded name means
  # this database holds other SQL under a timestamp this release still needs.
  NAME_CONFLICT=$(jq -r --arg files "$RELEASE_MIGRATIONS" '
    ($files | split("\n") | map(select(length > 0) | (split("_")[0]) as $ts
      | {key: $ts, value: .[($ts | length) + 1:]}) | from_entries) as $release
    | first(.[] | .version | (split("_")[0]) as $ts | .[($ts | length) + 1:] as $name
      | select($name != "" and $release[$ts] != null and $release[$ts] != $name)
      | [$ts, $name, $release[$ts]] | @tsv) // empty' <<< "$APPLIED")
  if [ -n "$NAME_CONFLICT" ]; then
    IFS=$'\t' read -r CONFLICT_TS CONFLICT_DB_NAME CONFLICT_RELEASE_NAME <<< "$NAME_CONFLICT"
    preflight_stop "Migration $CONFLICT_TS is recorded in the database as $CONFLICT_DB_NAME, but this release names it $CONFLICT_RELEASE_NAME. Database untouched; restore the database from the backup taken before the failed upgrade."
  fi
fi

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

# Preserve every artifact replaced by the installer, including version metadata.
for artifact in version.txt bun.lock scripts supabase; do
  if [ -e "$INSTALL_DIR/$artifact" ]; then
    cp -r "$INSTALL_DIR/$artifact" "$BACKUP_DIR/"
  fi
done

log "Backup created at $BACKUP_DIR"

# ===== STEP 6: STOP PM2 =====

write_progress "stopping" 55 "Stopping application..."
log "Stopping PM2 process: $PM2_NAME"

"$PM2_BIN" stop "$PM2_NAME" >> "$LOG_FILE" 2>&1 || log "WARNING: PM2 stop failed (process may not be running)"

# ===== STEP 7: SWAP FILES =====

write_progress "installing" 65 "Installing new version..."
log "Swapping files..."

# Keep the launcher outside the build tree that is about to be replaced.
cd "$INSTALL_DIR"

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
  cp "$EXTRACT_DIR/scripts/upgrade.sh" "$INSTALL_DIR/scripts/upgrade.sh.next"
  chmod +x "$INSTALL_DIR/scripts/upgrade.sh.next"
  mv -f "$INSTALL_DIR/scripts/upgrade.sh.next" "$INSTALL_DIR/scripts/upgrade.sh"
fi

# Replace supabase/ as a whole: files left by earlier releases must not survive.
rm -rf "$INSTALL_DIR/supabase.next"
cp -r "$EXTRACT_DIR/supabase" "$INSTALL_DIR/supabase.next"
rm -rf "$INSTALL_DIR/supabase"
mv "$INSTALL_DIR/supabase.next" "$INSTALL_DIR/supabase"

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

# .env.local is dotenv data (JSON/PEM/quotes), never executable shell. This
# preserves Stackpilot's environment contract in the downloaded runner too.
load_pm2_environment() {
  [ -f "$INSTALL_DIR/.env.local" ] || return 0
  local environment_file="$TMP_DIR/pm2-environment" key value
  if ! "${NODE_BIN:-node}" -e '
    const { readFileSync } = require("node:fs");
    const { parseEnv } = require("node:util");
    for (const [key, value] of Object.entries(parseEnv(readFileSync(process.argv[1], "utf8")))) {
      process.stdout.write(key + "\0" + value + "\0");
    }
  ' "$INSTALL_DIR/.env.local" > "$environment_file"; then
    log "ERROR: Could not parse PM2 environment"
    return 1
  fi
  while IFS= read -r -d '' key && IFS= read -r -d '' value; do
    export "$key=$value"
  done < "$environment_file"
  rm -f "$environment_file"
}

# Restore only code/configuration. A failed migration batch is rolled back by the
# database itself; migrations of a successful batch stay applied.
rollback_code() {
  local old_server="$BACKUP_DIR/.next/standalone/admin-panel/server.js"
  [ -f "$old_server" ] || old_server="$BACKUP_DIR/.next/standalone/server.js"
  if [ ! -f "$old_server" ]; then
    log "ERROR: Previous server.js missing from backup; application remains stopped"
    return 1
  fi
  "$PM2_BIN" stop "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
  "$PM2_BIN" delete "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
  cd "$INSTALL_DIR" || return 1
  local artifact
  for artifact in .next public package.json version.txt bun.lock scripts supabase .env.local; do
    rm -rf "$INSTALL_DIR/$artifact" || return 1
    if [ -e "$BACKUP_DIR/$artifact" ]; then
      cp -r "$BACKUP_DIR/$artifact" "$INSTALL_DIR/" || return 1
    fi
  done
  old_server="$INSTALL_DIR/.next/standalone/admin-panel/server.js"
  [ -f "$old_server" ] || old_server="$INSTALL_DIR/.next/standalone/server.js"
  load_pm2_environment || return 1
  local old_port
  old_port=$(grep -E '^PORT=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2 || true)
  if ! [[ "$old_port" =~ ^[0-9]+$ ]] || [ "$old_port" -lt 1024 ] || [ "$old_port" -gt 65535 ]; then
    old_port=3333
  fi
  cd "$(dirname "$old_server")" || return 1
  PORT="$old_port" HOSTNAME="${HOSTNAME:-::}" "$PM2_BIN" start "$(basename "$old_server")" --name "$PM2_NAME" \
    --max-memory-restart "${SELLF_PM2_MAX_MEMORY:-512M}" \
    --node-args="--max-old-space-size=${SELLF_NODE_MAX_OLD_SPACE:-400}" >> "$LOG_FILE" 2>&1 || return 1
  "$PM2_BIN" save >> "$LOG_FILE" 2>&1 || true
  log "Previous code restored; database migrations were not reversed"
}

write_progress "migrating" 75 "Running database migrations..."
log "Running migrations..."
MIGRATION_ERRORS=0
MIGRATION_CAUSE=""
MIGRATION_FAILED_FILE=""
MIGRATION_PENDING_COUNT=0

# migration-batch:start
# All pending migrations of this release go to apply_migration in ONE call, so
# PostgreSQL runs them in one transaction: an error in any file rolls back every
# file and every registry row. Each file runs in its own block so the error
# names it. The RPC records the last version; the batch records the others.
build_migration_batch() {
  local output="$1" quote last version
  shift
  quote="sellf_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  last="${!#}"
  : > "$output"
  for version in "$@"; do
    if grep -qF "\$${quote}" "$INSTALL_DIR/supabase/migrations/$version.sql"; then
      log "ERROR: Migration $version contains the batch quote; retry the update"
      return 1
    fi
    {
      printf 'DO $%s_block$\nBEGIN\nEXECUTE $%s_sql$\n' "$quote" "$quote"
      cat "$INSTALL_DIR/supabase/migrations/$version.sql"
      printf '\n$%s_sql$;\nEXCEPTION WHEN OTHERS THEN\n' "$quote"
      printf "  RAISE EXCEPTION 'Migration %% failed: %%', '%s', SQLERRM USING ERRCODE = SQLSTATE;\n" "$version"
      printf 'END\n$%s_block$;\n' "$quote"
      if [ "$version" != "$last" ]; then
        printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s');\n" \
          "${version%%_*}" "${version#*_}"
      fi
    } >> "$output" || return 1
  done
}

if [ "$APPLIED_STATE" = ok ] && [ -d "$INSTALL_DIR/supabase/migrations" ]; then
  MIGRATION_SKIPPED=0
  PENDING_MIGRATIONS=()

  # Exactly the release's file list, read on descriptor 3.
  while IFS= read -r VERSION <&3; do
    [ -n "$VERSION" ] || continue
    # The database records timestamps independently of migration names.
    if jq -e --arg v "${VERSION%%_*}" \
      'any(.[]; (.version | split("_")[0]) == $v)' <<< "$APPLIED" >/dev/null 2>&1; then
      MIGRATION_SKIPPED=$((MIGRATION_SKIPPED + 1))
      continue
    fi
    # Versions are embedded in the batch SQL; the RPC accepts only this format.
    if ! [[ "$VERSION" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]; then
      MIGRATION_CAUSE="Migration file name $VERSION is not in the YYYYMMDDHHMMSS_name format"
      MIGRATION_ERRORS=1
      break
    fi
    PENDING_MIGRATIONS+=("$VERSION")
  done 3<<< "$RELEASE_MIGRATIONS"
  MIGRATION_PENDING_COUNT=${#PENDING_MIGRATIONS[@]}

  if [ "$MIGRATION_ERRORS" -eq 0 ] && [ "$MIGRATION_PENDING_COUNT" -gt 0 ]; then
    BATCH_FILE="$TMP_DIR/migration-batch.sql"
    PAYLOAD_FILE="$TMP_DIR/migration-payload.json"
    LAST_MIGRATION="${PENDING_MIGRATIONS[$((MIGRATION_PENDING_COUNT - 1))]}"
    log "Applying $MIGRATION_PENDING_COUNT migrations in one transaction: ${PENDING_MIGRATIONS[*]}"
    # SQL and JSON travel through files, never as large process arguments.
    if ! build_migration_batch "$BATCH_FILE" "${PENDING_MIGRATIONS[@]}" 2>>"$LOG_FILE" ||
      ! CHECKSUM=$(sha256sum "$BATCH_FILE" | cut -d' ' -f1) ||
      ! jq -n --arg v "$LAST_MIGRATION" --rawfile s "$BATCH_FILE" --arg c "$CHECKSUM" \
        '{migration_version: $v, migration_sql: $s, content_checksum: $c}' > "$PAYLOAD_FILE" 2>>"$LOG_FILE"; then
      MIGRATION_CAUSE="The migration request could not be prepared"
      MIGRATION_ERRORS=1
    elif ! RESULT=$(migration_rpc apply_migration "@$PAYLOAD_FILE"); then
      MIGRATION_CAUSE=$(jq -r 'if type == "object" and (.message | type) == "string" then .message else empty end' \
        "$TMP_DIR/migration-response.json" 2>/dev/null || true)
      MIGRATION_CAUSE="${MIGRATION_CAUSE:-The database did not accept the migration request (see the upgrade log)}"
      MIGRATION_ERRORS=1
    elif ! OUTCOME=$(jq -er -s '
      if length != 1 then error("Expected one result")
      else .[0] |
        if type != "object" then error("Expected an object")
        elif (.success | type) != "boolean" then error("Expected success boolean")
        elif has("skipped") and (.skipped | type) != "boolean" then error("Expected skipped boolean")
        elif .success == false then "failed"
        elif .skipped == true then "skipped"
        else "applied"
        end
      end' <<< "$RESULT" 2>/dev/null); then
      printf '%s\n' "$RESULT" >> "$LOG_FILE"
      MIGRATION_CAUSE="The migration RPC returned an invalid response (see the upgrade log)"
      MIGRATION_ERRORS=1
    elif [ "$OUTCOME" = failed ]; then
      printf '%s\n' "$RESULT" >> "$LOG_FILE"
      MIGRATION_CAUSE=$(jq -r '.message | if type == "string" then . else "The migration RPC reported a failure" end' <<< "$RESULT")
      MIGRATION_ERRORS=1
    elif [ "$OUTCOME" = skipped ]; then
      # Nothing ran: another process recorded the last version after the status check.
      printf '%s\n' "$RESULT" >> "$LOG_FILE"
      MIGRATION_CAUSE="The migration registry changed during the update"
      MIGRATION_ERRORS=1
    else
      log "Migrations applied: $RESULT"
    fi
  fi

  MIGRATION_CAUSE=$(printf '%s' "$MIGRATION_CAUSE" | tr -d '\000-\037' | cut -c1-300)
  MIGRATION_FAILED_FILE=$(printf '%s' "$MIGRATION_CAUSE" | sed -n 's/^Migration \([0-9]\{14\}_[a-z0-9_]*\) failed: .*/\1/p')
  if [ "$MIGRATION_ERRORS" -eq 0 ]; then
    MIGRATION_COUNT=$MIGRATION_PENDING_COUNT
  else
    MIGRATION_COUNT=0
    log "ERROR: Migrations rolled back: $MIGRATION_CAUSE"
  fi
  log "Migrations complete: $MIGRATION_COUNT applied, $MIGRATION_SKIPPED already applied, $MIGRATION_ERRORS errors"
else
  MIGRATION_ERRORS=1
  MIGRATION_CAUSE="Supabase connection settings or the migration directory are missing"
  log "Migrations incomplete (missing Supabase config or migration directory)"
fi
# migration-batch:end

if [ "$MIGRATION_ERRORS" -gt 0 ]; then
  log "ERROR: Migrations failed; restoring previous code before any new-version startup"
  write_progress "rolling_back" 85 "Database migration failed. Restoring previous code..."
  MIGRATION_MESSAGE="Database migration failed: ${MIGRATION_CAUSE%.}."
  if [ "$MIGRATION_PENDING_COUNT" -gt 0 ]; then
    MIGRATION_MESSAGE="$MIGRATION_MESSAGE All $MIGRATION_PENDING_COUNT pending migrations of this release were rolled back together; the database is as it was before the update."
  else
    MIGRATION_MESSAGE="$MIGRATION_MESSAGE No migration of this release was applied."
  fi
  PREVIOUS_VERSION=$(INSTALL_DIR="$BACKUP_DIR" read_installed_version || true)
  if rollback_code; then
    write_failure migration_failed "$MIGRATION_MESSAGE The previous code was restored; the shop is running the previous version${PREVIOUS_VERSION:+ (${PREVIOUS_VERSION#v})} again." \
      cause "$MIGRATION_CAUSE" migration "$MIGRATION_FAILED_FILE" installed_version "${PREVIOUS_VERSION#v}" rollback true
  else
    write_failure migration_failed "$MIGRATION_MESSAGE Restoring the previous code failed. Application remains stopped." \
      cause "$MIGRATION_CAUSE" migration "$MIGRATION_FAILED_FILE"
  fi
  rm -rf "$TMP_DIR"
  exit 1
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
  if rollback_code; then
    write_error "Upgrade failed: server.js not found. Rolled back to previous version." true
  else
    write_error "Upgrade failed: server.js not found and code restoration failed. Application remains stopped."
  fi
  rm -rf "$TMP_DIR"
  exit 1
fi

# Read PORT from .env.local and validate
PORT=$(grep -E '^PORT=' "$INSTALL_DIR/.env.local" 2>/dev/null | cut -d= -f2 || true)
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  PORT=3333
fi

# Delete old PM2 entry and start fresh
"$PM2_BIN" delete "$PM2_NAME" >> "$LOG_FILE" 2>&1 || true
cd "$(dirname "$SERVER_JS")"
# Load .env.local into shell so PM2 captures actual values.
# dotenv in server.js won't override vars already set by PM2, so we pre-load them here.
load_pm2_environment
MEM_LIMIT="${SELLF_PM2_MAX_MEMORY:-512M}"
OLD_SPACE="${SELLF_NODE_MAX_OLD_SPACE:-400}"
# ::: loopback only — app runs behind Caddy, never exposed directly
PORT="${PORT}" HOSTNAME="${HOSTNAME:-::}" "$PM2_BIN" start "$(basename "$SERVER_JS")" --name "$PM2_NAME" \
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
  "$PM2_BIN" save >> "$LOG_FILE" 2>&1 || true
  write_progress "done" 100 "Upgrade to ${TAG_NAME} completed successfully!"
  log "Upgrade complete! Version: $TAG_NAME"
else
  log "ERROR: Health check failed after 60s — rolling back!"
  write_progress "rolling_back" 95 "Health check failed. Rolling back..."

  if rollback_code; then
    write_error "Upgrade failed: health check timeout. Rolled back to previous version." true
  else
    write_error "Upgrade failed: health check timeout and code restoration failed. Application remains stopped."
  fi
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
