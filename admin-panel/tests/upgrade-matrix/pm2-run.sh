#!/usr/bin/env bash
set -euo pipefail
INSTALL=/opt/stacks/sellf-matrix/admin-panel
mkdir -p "$INSTALL/.next/standalone/admin-panel" "$INSTALL/scripts" /transport
cp /fixtures/upgrade.sh "$INSTALL/scripts/upgrade.sh"
cp /fixtures/.env.local "$INSTALL/.env.local"
printf '{"version":"2026.1.0"}\n' > "$INSTALL/package.json"
cat > "$INSTALL/.next/standalone/admin-panel/server.js" <<'JS'
require('http').createServer((req,res) => { res.setHeader('Content-Type','application/json'); res.end('{"status":"ok","version":"old"}'); }).listen(3000,'0.0.0.0');
JS
# Only replace transport; the complete updater and its installed key remain unchanged.
cat > /transport/curl <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    https://api.github.com/repos/*/releases/latest) cat /fixtures/release.json; exit 0 ;;
    https://github.com/*/releases/download/*)
      name="${arg##*/}"
      destination=''
      while [ "$#" -gt 0 ]; do
        if [ "$1" = '-o' ]; then destination="$2"; break; fi
        shift
      done
      [ -n "$destination" ] && cp "/fixtures/$name" "$destination"
      exit 0 ;;
  esac
done
exec /usr/bin/curl "$@"
SH
chmod +x /transport/curl
cd "$INSTALL/.next/standalone/admin-panel"
pm2 start server.js --name sellf-matrix --interpreter node
OLD_PID=$(pm2 pid sellf-matrix)
cd /
TOKEN=$(cat /proc/sys/kernel/random/uuid)
if ! (cd "$INSTALL/.next/standalone/admin-panel"; PATH="/transport:$PATH" bash "$INSTALL/scripts/upgrade.sh" "$TOKEN" "$INSTALL"); then
  cat "/run/sellf/sellf-upgrade-$TOKEN.json"
  cat "/run/sellf/sellf-upgrade-$TOKEN.log"
  pm2 logs sellf-matrix --lines 30 --nostream
  exit 1
fi
STATUS="/run/sellf/sellf-upgrade-$TOKEN.json"
if ! jq -e '.step == "done"' "$STATUS"; then cat "$STATUS"; cat "/run/sellf/sellf-upgrade-$TOKEN.log"; exit 1; fi
NEW_PID=$(pm2 pid sellf-matrix)
[ "$NEW_PID" != "$OLD_PID" ] && [ "$NEW_PID" != '0' ]
EXPECTED=$(node -p "require('/fixtures/release.json').tag_name.replace(/^v/,'')")
ACTUAL=$(node -p "require('$INSTALL/package.json').version")
[ "$ACTUAL" = "$EXPECTED" ]
curl -fsS http://localhost:3000/api/health > /dev/null
source /fixtures/.env.local
LIVE=$(curl -fsS -H "Authorization: Bearer $MATRIX_API_KEY" 'http://localhost:3000/api/v1/system/update-check?force=true' | jq -r '.data.current_version')
[ "$LIVE" = "$EXPECTED" ]
jq -e 'any(.[]; .name == "sellf-matrix")' /root/.pm2/dump.pm2 > /dev/null
# A PM2 daemon restart reloads the saved upgraded process and build.
pm2 kill
pm2 resurrect
for attempt in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health > /dev/null; then break; fi
  sleep 1
done
curl -fsS http://localhost:3000/api/health > /dev/null
printf 'MATRIX_PM2_DONE version=%s\n' "$ACTUAL"
pm2 kill
