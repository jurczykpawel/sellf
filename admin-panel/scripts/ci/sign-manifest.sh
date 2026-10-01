#!/usr/bin/env bash
# Shared Ed25519 sign/verify primitive for release manifests (see AGENTS.md
# "Release signing"). Every manifest CI publishes — the tarball manifest and
# the image manifest — is signed the same way with $RELEASE_SIGNING_KEY, and
# verified in CI against the public key embedded in scripts/upgrade.sh, the
# same key already-installed servers trust. Keeping the sign/verify commands
# in one script avoids two copies drifting apart as more manifests are added.
#
# Usage:
#   sign-manifest.sh sign   <manifest-file> <sig-file>
#   sign-manifest.sh verify <manifest-file> <sig-file> [upgrade-sh-path]
#
# sign:   reads the private key from $RELEASE_SIGNING_KEY (PEM, required),
#         signs <manifest-file>, writes <sig-file>.
# verify: extracts the trusted public key from [upgrade-sh-path] (default:
#         the upgrade.sh next to this script) and verifies <sig-file>
#         against <manifest-file>. Refuses a missing or placeholder key.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_UPGRADE_SH="$SCRIPT_DIR/../upgrade.sh"

cmd="${1:-}"

case "$cmd" in
  sign)
    manifest_file="${2:?usage: sign-manifest.sh sign <manifest-file> <sig-file>}"
    sig_file="${3:?usage: sign-manifest.sh sign <manifest-file> <sig-file>}"

    if [ -z "${RELEASE_SIGNING_KEY:-}" ]; then
      echo "::error::RELEASE_SIGNING_KEY is not set — refusing to sign" >&2
      exit 1
    fi

    umask 077
    key_file="$(mktemp)"
    trap 'rm -f "$key_file"' EXIT
    printf '%s\n' "$RELEASE_SIGNING_KEY" > "$key_file"

    openssl pkeyutl -sign -inkey "$key_file" -rawin -in "$manifest_file" -out "$sig_file"
    ;;

  verify)
    manifest_file="${2:?usage: sign-manifest.sh verify <manifest-file> <sig-file> [upgrade-sh-path]}"
    sig_file="${3:?usage: sign-manifest.sh verify <manifest-file> <sig-file> [upgrade-sh-path]}"
    upgrade_sh="${4:-$DEFAULT_UPGRADE_SH}"

    if [ ! -f "$upgrade_sh" ]; then
      echo "::error::cannot find $upgrade_sh to read the trusted signing key" >&2
      exit 1
    fi

    umask 077
    pub_file="$(mktemp)"
    trap 'rm -f "$pub_file"' EXIT
    sed -n '/^# release-signing-key:start/,/^# release-signing-key:end/p' "$upgrade_sh" \
      | sed -n '/^-----BEGIN PUBLIC KEY-----$/,/^-----END PUBLIC KEY-----$/p' > "$pub_file"

    if [ ! -s "$pub_file" ]; then
      echo "::error::could not find a release signing public key in $upgrade_sh" >&2
      exit 1
    fi
    if grep -q 'REPLACE_WITH_RELEASE_SIGNING_PUBLIC_KEY' "$pub_file"; then
      echo "::error::$upgrade_sh still holds the placeholder release signing public key" >&2
      exit 1
    fi

    openssl pkeyutl -verify -pubin -inkey "$pub_file" -rawin -in "$manifest_file" -sigfile "$sig_file"
    ;;

  *)
    echo "usage: sign-manifest.sh <sign|verify> ..." >&2
    exit 1
    ;;
esac
