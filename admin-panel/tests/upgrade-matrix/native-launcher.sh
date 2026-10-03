#!/usr/bin/env bash
# Optional Linux-host launcher check; all files and the process belong to this fixture.
set -euo pipefail
FIXTURE=/tmp/sellf-ui-upgrade-matrix
INSTALL="$FIXTURE/admin-panel"
PM2=/root/.bun/bin/pm2
[ ! -e "$FIXTURE" ] || { echo 'Fixture path already exists'; exit 1; }
[ -x "$PM2" ] && [ -x /usr/bin/systemd-run ]
mkdir -p "$INSTALL/.next/standalone/admin-panel" "$INSTALL/scripts"
cleanup() {
  cd /
  "$PM2" delete sellf-ui-upgrade-matrix >/dev/null 2>&1 || true
  rm -rf "$FIXTURE"
}
trap cleanup EXIT
cp /tmp/sellf-upgrade-capability.mjs "$FIXTURE/capability.mjs"
touch "$INSTALL/.env.local" "$INSTALL/scripts/upgrade.sh"
cat > "$FIXTURE/restart.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
sleep 1
/root/.bun/bin/pm2 stop sellf-ui-upgrade-matrix >/dev/null
/root/.bun/bin/pm2 start sellf-ui-upgrade-matrix >/dev/null
printf 'done\n' > /tmp/sellf-ui-upgrade-matrix/result
SH
cat > "$INSTALL/.next/standalone/admin-panel/server.js" <<'JS'
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
require('http').createServer(async (req, res) => {
  if (req.url === '/start') {
    const child = spawn('/usr/bin/systemd-run', [`--unit=sellf-matrix-${randomUUID()}`, '--collect', '--no-block', '--setenv=HOME=/root', '--setenv=PM2_HOME=/root/.pm2', `--setenv=PATH=${process.env.PATH}`, '--', 'bash', '/tmp/sellf-ui-upgrade-matrix/restart.sh'], { stdio: 'ignore' });
    child.once('error', () => { res.statusCode = 500; res.end(); });
    child.once('exit', code => { res.statusCode = code === 0 ? 202 : 500; res.end(); });
    return;
  }
  const { getUpgradeCapability } = await import('/tmp/sellf-ui-upgrade-matrix/capability.mjs');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ...getUpgradeCapability(), pid: process.pid }));
}).listen(55341, '127.0.0.1');
JS
cd "$INSTALL/.next/standalone/admin-panel"
PATH="/root/.bun/bin:$PATH" "$PM2" start server.js --name sellf-ui-upgrade-matrix --interpreter node >/dev/null
for attempt in $(seq 1 30); do
  if curl -fsS http://localhost:55341 > "$FIXTURE/before.json"; then break; fi
  sleep 1
done
python3 -c 'import json; d=json.load(open("/tmp/sellf-ui-upgrade-matrix/before.json")); assert d["runtime"]=="pm2" and d["mode"]=="in-place"'
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:55341/start)" = '202' ]
for attempt in $(seq 1 30); do
  if [ -f "$FIXTURE/result" ] && curl -fsS http://localhost:55341 > "$FIXTURE/after.json"; then break; fi
  sleep 1
done
python3 -c 'import json; a=json.load(open("/tmp/sellf-ui-upgrade-matrix/before.json")); b=json.load(open("/tmp/sellf-ui-upgrade-matrix/after.json")); assert a["pid"]!=b["pid"] and b["mode"]=="in-place"; print("PASS native PM2 preflight and systemd transient restart")'
