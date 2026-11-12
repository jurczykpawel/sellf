#!/usr/bin/env bash
# Write signed-manifest inputs. Legacy format is retained ONLY while updater 1
# is supported; publishing it with a higher minimum would bypass that minimum.
# @see ../upgrade.sh @see .github/workflows/build-release.yml
set -euo pipefail
version="${1:?version required}"
archive="${2:?archive required}"
output="${3:?output directory required}"
updater="${4:-$(dirname "$0")/../upgrade.sh}"
[[ "$version" =~ ^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] || { echo 'Invalid version' >&2; exit 1; }
minimum=$(sed -n 's/^MIN_UPDATER_VERSION=//p' "$updater")
[[ "$minimum" =~ ^[1-9][0-9]{0,8}$ ]] || { echo 'Invalid min_updater_version' >&2; exit 1; }
checksum=$(sha256sum "$archive" | awk '{print $1}')
mkdir -p "$output"
printf 'version=%s\nsha256=%s\nmin_updater_version=%s\n' "$version" "$checksum" "$minimum" > "$output/sellf-build.v2.manifest"
if [ "$minimum" = 1 ]; then
  printf 'version=%s\nsha256=%s\n' "$version" "$checksum" > "$output/sellf-build.manifest"
else
  rm -f "$output/sellf-build.manifest" "$output/sellf-build.manifest.sig"
fi
