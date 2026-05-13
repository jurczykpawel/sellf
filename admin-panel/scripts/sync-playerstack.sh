#!/usr/bin/env bash
set -euo pipefail

ADMIN_PANEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SELLF_ROOT="$(cd "$ADMIN_PANEL_DIR/.." && pwd)"
PLAYERSTACK_REPO_DEFAULT="$(cd "$SELLF_ROOT/../playerstack" 2>/dev/null && pwd || true)"
PLAYERSTACK_REPO="${PLAYERSTACK_REPO:-$PLAYERSTACK_REPO_DEFAULT}"

if [[ -z "${PLAYERSTACK_REPO}" || ! -d "${PLAYERSTACK_REPO}" ]]; then
  echo "error: playerstack repo not found. Set PLAYERSTACK_REPO=/path/to/playerstack" >&2
  exit 1
fi

EMBED_PKG="$PLAYERSTACK_REPO/packages/embed"
if [[ ! -d "$EMBED_PKG" ]]; then
  echo "error: $EMBED_PKG missing — is this the right repo?" >&2
  exit 1
fi

PS_DIRTY="$(git -C "$PLAYERSTACK_REPO" status --porcelain)"
if [[ -n "$PS_DIRTY" ]]; then
  echo "error: playerstack repo has uncommitted changes; commit them before syncing" >&2
  echo "       sellf pins to a specific playerstack commit SHA — dirty trees cannot be reproduced in CI" >&2
  echo "" >&2
  echo "$PS_DIRTY" >&2
  exit 1
fi
PS_SHA="$(git -C "$PLAYERSTACK_REPO" rev-parse HEAD)"

echo "[1/4] building playerstack at $PLAYERSTACK_REPO @ ${PS_SHA:0:12}"
( cd "$EMBED_PKG" && bun run build >/dev/null )

BUNDLE="$EMBED_PKG/dist/playerstack.min.js"
if [[ ! -s "$BUNDLE" ]]; then
  echo "error: build did not produce $BUNDLE" >&2
  exit 1
fi

SHORT_HASH="$(openssl dgst -sha256 "$BUNDLE" | awk '{print $2}' | cut -c1-12)"
SRI="sha384-$(openssl dgst -sha384 -binary "$BUNDLE" | openssl base64 -A)"
DEST_DIR="$ADMIN_PANEL_DIR/public/vendor/playerstack"
DEST_FILE="$DEST_DIR/playerstack-${SHORT_HASH}.min.js"
SRC_FILE="$ADMIN_PANEL_DIR/src/lib/playerstack.ts"

echo "[2/4] copying bundle -> $DEST_FILE"
mkdir -p "$DEST_DIR"
find "$DEST_DIR" -maxdepth 1 -type f -name 'playerstack-*.min.js' ! -name "playerstack-${SHORT_HASH}.min.js" -print -delete
cp "$BUNDLE" "$DEST_FILE"
chmod 0644 "$DEST_FILE"

echo "[3/4] patching $SRC_FILE"
NEW_SRC="/vendor/playerstack/playerstack-${SHORT_HASH}.min.js"
node -e "
const fs = require('fs');
const path = '$SRC_FILE';
const src = fs.readFileSync(path, 'utf8');
const srcRe = /(export const PLAYERSTACK_SCRIPT_SRC = ')[^']+(';)/;
const intRe = /(export const PLAYERSTACK_SCRIPT_INTEGRITY =\s*\n?\s*')[^']+(';)/;
const shaRe = /(export const PLAYERSTACK_COMMIT_SHA = ')[a-f0-9]*(';)/;
if (!srcRe.test(src) || !intRe.test(src) || !shaRe.test(src)) {
  console.error('error: constants not found in', path);
  process.exit(1);
}
const after = src
  .replace(srcRe, '\$1$NEW_SRC\$2')
  .replace(intRe, '\$1$SRI\$2')
  .replace(shaRe, '\$1$PS_SHA\$2');
fs.writeFileSync(path, after);
"

echo "[4/4] done"
echo "  src:        $NEW_SRC"
echo "  integrity:  $SRI"
echo "  bundle:     $DEST_FILE"
echo "  pinned to:  playerstack@${PS_SHA:0:12}"
