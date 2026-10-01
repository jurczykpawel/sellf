#!/usr/bin/env bash
# Run as root in the image built by upgrade-pm2-linux.Dockerfile.
set -euo pipefail
minimal_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# The Node process PATH plus dirname(process.execPath), as passed by the route.
route_path=$(PATH="$minimal_path" node -e 'console.log([...new Set([...process.env.PATH.split(":"),require("path").dirname(process.execPath)])].join(":"))')
install=/opt/sellf/admin-panel
printf 'unchanged installation\n' > "$install/sentinel"
before=$(find "$install" -type f -exec sha256sum {} + | sort)
printf 'uid=%s route_PATH=%s\n' "$(id -u)" "$route_path"
test -x /root/.bun/bin/pm2
test ! -e /usr/local/bin/pm2
test ! -e /usr/bin/pm2
if env -i HOME=/root PM2_HOME=/root/.pm2 PATH="$route_path" bash -c 'command -v pm2'; then
  echo 'PM2 unexpectedly in minimal PATH'; exit 1
fi
positive=11111111-1111-1111-1111-111111111111
# Deliberate 404 stops before release download after resolving and using real PM2.
set +e
env -i HOME=/root PM2_HOME=/root/.pm2 PATH="$route_path" GITHUB_REPO=jurczykpawel/sellf-pm2-preflight-fixture-does-not-exist \
  bash "$install/scripts/upgrade.sh" "$positive" "$install"
positive_code=$?
set -e
cat "/run/sellf/sellf-upgrade-$positive.log"
cat "/run/sellf/sellf-upgrade-$positive.json"
test "$positive_code" -eq 1
grep -F 'PM2_BIN: /root/.bun/bin/pm2' "/run/sellf/sellf-upgrade-$positive.log"
grep -F 'Failed to fetch release info' "/run/sellf/sellf-upgrade-$positive.json"
test "$before" = "$(find "$install" -type f -exec sha256sum {} + | sort)"
echo 'POSITIVE: real Bun-installed PM2 resolved and used; stopped at release fetch; install unchanged'
/root/.bun/bin/pm2 kill >/dev/null 2>&1
mv /root/.bun/bin/pm2 /root/.bun/bin/pm2-disabled
negative=22222222-2222-2222-2222-222222222222
set +e
env -i HOME=/root PM2_HOME=/root/.pm2 PATH="$route_path" \
  bash "$install/scripts/upgrade.sh" "$negative" "$install"
negative_code=$?
set -e
cat "/run/sellf/sellf-upgrade-$negative.log"
cat "/run/sellf/sellf-upgrade-$negative.json"
test "$negative_code" -eq 1
grep -F 'PM2 executable not found' "/run/sellf/sellf-upgrade-$negative.json"
test "$before" = "$(find "$install" -type f -exec sha256sum {} + | sort)"
echo 'NEGATIVE: PM2 absent; preflight failed; all install file hashes unchanged'
