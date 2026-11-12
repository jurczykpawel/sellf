"""Complete installed updater with signed local HTTP assets; no external services.

Only the test public key and private runtime path replace production values.
GitHub transport is redirected to loopback by a curl shim; real curl/OpenSSL/tar
and the full updater (including migrations, swap, health, rollback) still run.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import socket
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

source = Path(sys.argv[1]).read_text()
legacy = Path(sys.argv[2]).read_text() if len(sys.argv) > 2 else None
results = []
with tempfile.TemporaryDirectory(prefix='sellf-bootstrap-') as temporary:
    root = Path(temporary)
    key = root / 'key.pem'
    subprocess.run(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', str(key)], check=True, capture_output=True)
    public = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout'], text=True).strip()

    def case(name, stage2=True, minimum=1, bad_signature=False, bad_checksum=False, installed_source=None, fail_migration=False, real_pm2=False, real_rpc=False):
        if os.environ.get('BOOTSTRAP_CASE') and os.environ['BOOTSTRAP_CASE'] != name:
            return
        folder = root / name
        folder.mkdir()
        install = folder / 'stack/admin-panel'
        install.mkdir(parents=True)
        runtime = folder / 'runtime'
        runtime.mkdir(mode=0o700)
        bin_dir = folder / 'bin'
        bin_dir.mkdir()
        requests = []
        assets = {}
        rpc_config = None
        if real_rpc:
            rpc_config = json.loads(Path(os.environ['BOOTSTRAP_REAL_RPC_CONFIG']).read_text())
            assert rpc_config['url'] == 'http://host.docker.internal:56521'
        migration_version = ('2099' + str(uuid.uuid4().int)[-10:] + '_bootstrap_fixture') if real_rpc else '20261110235900_fixture'
        port = None

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append(self.path)
                if self.path == '/latest':
                    body = json.dumps({'tag_name': 'v2026.11.0', 'assets': [
                        {'name': asset, 'browser_download_url': 'https://github.com/jurczykpawel/sellf/releases/download/v2026.11.0/' + asset}
                        for asset in assets]}).encode()
                elif self.path == '/api/health':
                    body = b'healthy'
                else:
                    body = assets.get(self.path.rsplit('/', 1)[-1])
                self.send_response(200 if body is not None else 404)
                self.end_headers()
                self.wfile.write(body or b'not found')

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                status = 200
                if rpc_config:
                    headers = {'Content-Type': 'application/json', 'apikey': rpc_config['key'], 'Authorization': 'Bearer ' + rpc_config['key']}
                    try:
                        with urlopen(Request(rpc_config['url'] + self.path, data=body, headers=headers), timeout=10) as upstream:
                            response = upstream.read()
                    except HTTPError as error:
                        status = error.code
                        response = error.read()
                    if self.path.endswith('apply_migration'):
                        payload = json.loads(body)
                        assert payload['migration_sql'] == sql.rstrip('\n')
                        assert payload['content_checksum'] == hashlib.sha256(sql.rstrip('\n').encode()).hexdigest()
                        requests.append('POSTGRES_SQL:' + str(len(payload['migration_sql'])))
                elif self.path.endswith('get_migration_status'):
                    response = b'[]'
                else:
                    payload = json.loads(body)
                    assert payload['migration_sql'] == sql.rstrip('\n')
                    assert payload['content_checksum'] == hashlib.sha256(sql.rstrip('\n').encode()).hexdigest()
                    requests.append('SQL:' + str(len(payload['migration_sql'])))
                    response = b'{"success":false,"message":"fixture failure"}' if fail_migration else b'{"success":true}'
                self.send_response(status)
                self.end_headers()
                self.wfile.write(response)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        port = server.server_port
        app_port = port
        if real_pm2:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                app_port = probe.getsockname()[1]
        real_pm2_bin = shutil.which('pm2')
        pm2_environment = {'PM2_HOME': str(folder / 'pm2-home')} if real_pm2 else {}
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def executable(name, text):
            path = bin_dir / name
            path.write_text('#!/usr/bin/env bash\n' + text + '\n')
            path.chmod(0o755)

        curl = shutil.which('curl')
        executable('curl', '''args=()
for arg in "$@"; do
 case "$arg" in
 https://api.github.com/*) arg="http://127.0.0.1:''' + str(port) + '''/latest" ;;
 https://github.com/*) arg="http://127.0.0.1:''' + str(port) + '''/${arg##*/}" ;;
 esac
 args+=("$arg")
done
exec ''' + shlex.quote(curl) + ''' "${args[@]}"''')
        executable('pm2', 'printf "%s\\n" "$*" >> "$FIXTURE/pm2.log"\nif [ "$1" = start ]; then cat "$FIXTURE/stack/admin-panel/.next/standalone/admin-panel/server.js" >> "$FIXTURE/started"; printf "%s\\n" "${LITERAL:-}" "${QUOTED:-}" "${SELLF_TEMPLATE_LICENSE_POLICIES:-}" > "$FIXTURE/pm2-environment"; fi')
        if real_pm2:
            assert real_pm2_bin, 'Real PM2 required'
            executable('pm2', 'printf "%s\\n" "$*" >> "$FIXTURE/pm2.log"\nif [ "$1" = start ]; then head -c 11 "$FIXTURE/stack/admin-panel/.next/standalone/admin-panel/server.js" >> "$FIXTURE/started"; fi\nexec ' + shlex.quote(real_pm2_bin) + ' "$@"')
        executable('sleep', 'exec /bin/sleep 0.5' if real_pm2 else 'exit 0')
        # The test needs Node only for preflight; PM2 is a recorded test process.
        executable('node', 'exec ' + shlex.quote(shutil.which('node')) + ' "$@"')
        if not shutil.which('flock'):
            executable('flock', 'exit 0')

        def server_code(version):
            return ('// ' + version + '\n' + "require('node:http').createServer((req,res)=>res.end('healthy')).listen(Number(process.env.PORT),'127.0.0.1');") if real_pm2 else version

        for relative, data in {
            '.next/standalone/admin-panel/server.js': server_code('old-code'),
            'version.txt': '2026.10.6\n',
            'package.json': '{"version":"2026.10.6"}',
            '.env.local': f'SUPABASE_URL=http://127.0.0.1:{port}\nSUPABASE_SERVICE_ROLE_KEY=fixture-key\nPORT={app_port}\n',
        }.items():
            path = install / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(data)
        if not installed_source:
            with (install / '.env.local').open('a') as dotenv:
                dotenv.write("""SELLF_TEMPLATE_LICENSE_POLICIES=[{"templateId":"fixture","pem":"public\\nkey"}]\nLITERAL=$(echo changed)\nQUOTED='a b = c'\n""")
        def test_source(text):
            text = re.sub(r'-----BEGIN PUBLIC KEY-----.*?-----END PUBLIC KEY-----', public, text, flags=re.S)
            start = text.index('# runtime-dir:start')
            end = text.index('# runtime-dir:end', start)
            return text[:start] + 'RUNTIME_DIR=' + shlex.quote(str(runtime)) + '\n' + text[end:]

        old_script = install / 'scripts/upgrade.sh'
        old_script.parent.mkdir()
        old_script.write_text(test_source(installed_source or source))
        new_source = test_source(source).replace('# ===== STEP 5: BACKUP =====', 'log "DOWNLOADED_STAGE2:$TOKEN:$INSTALL_DIR:$PROGRESS_FILE"\nif [ -e /proc/sys/kernel/random/uuid ]; then\n  if flock -n "$LOCK_FILE" -c true; then echo "Instance lock lost" >&2; exit 77; fi\nfi\n# ===== STEP 5: BACKUP =====')
        sql = '-- ' + 'x' * 160000 + '\nSELECT 1;\n\n'
        files = {'.next/standalone/admin-panel/server.js': server_code('new-code'),
                 'version.txt': '2026.11.0\n', 'package.json': '{"version":"2026.11.0"}',
                 f'supabase/migrations/{migration_version}.sql': sql}
        if stage2:
            files['scripts/upgrade.sh'] = new_source
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
            # Existing validator requires the standalone directory entry.
            for directory in ['.next', '.next/standalone', '.next/standalone/admin-panel']:
                entry = tarfile.TarInfo(directory)
                entry.type = tarfile.DIRTYPE
                entry.mode = 0o755
                tar.addfile(entry)
            for relative, text in files.items():
                data = text.encode()
                entry = tarfile.TarInfo(relative)
                entry.size = len(data)
                entry.mode = 0o644
                tar.addfile(entry, io.BytesIO(data))
        archive = buffer.getvalue()
        checksum = hashlib.sha256(archive).hexdigest()
        manifest = f'version=2026.11.0\nsha256={checksum}\n'.encode()
        assets['sellf-build.tar.gz'] = archive + (b'tampered' if bad_checksum else b'')
        for asset, content in [('sellf-build.manifest', manifest), ('sellf-build.v2.manifest', manifest + f'min_updater_version={minimum}\n'.encode())]:
            file = folder / asset
            file.write_bytes(content)
            sig = subprocess.check_output(['openssl', 'pkeyutl', '-sign', '-inkey', str(key), '-rawin', '-in', str(file)])
            assets[asset] = content + (b'tampered\n' if bad_signature else b'')
            assets[asset + '.sig'] = sig
        token = str(uuid.uuid4())
        try:
            run = subprocess.run(['bash', str(old_script), token, str(install)], env={**os.environ, 'FIXTURE': str(folder), 'PATH': str(bin_dir) + ':' + os.environ['PATH'], 'PM2_NAME': 'sellf-fixture', **pm2_environment}, capture_output=True, text=True, timeout=30)
            progress = json.loads((runtime / f'sellf-upgrade-{token}.json').read_text())
            log = (runtime / f'sellf-upgrade-{token}.log').read_text()
            delegated = 'DOWNLOADED_STAGE2:' in log
            if bad_signature or bad_checksum or minimum > 2:
                assert run.returncode == 1, (name, run.stderr, log)
                assert progress['step'] == 'failed', progress
                assert not delegated and not (folder / 'pm2.log').read_text().count('stop'), log
                assert not any(request.startswith(('SQL:', 'POSTGRES_SQL:')) for request in requests)
                assert (install / 'version.txt').read_text() == '2026.10.6\n'
                if minimum > 2:
                    assert 'Stackpilot' in progress['message'] and 'updater' in progress['message'], progress
                    assert '/sellf-build.tar.gz' not in requests
            else:
                # The immutable old runner self-copies over its open script inode.
                # Record its actual exit/stderr; only new-runner exits are acceptance
                # criteria. Both paths must still deliver SQL and reach the recorded
                # application outcome. Never count the old path as stage-2 execution.
                if not installed_source:
                    assert run.returncode == (1 if fail_migration else 0), (name, run.stderr, log, progress)
                assert delegated == (stage2 and not installed_source), (name, 'expected downloaded stage 2', log)
                if delegated:
                    assert f'DOWNLOADED_STAGE2:{token}:{install}:{runtime}/sellf-upgrade-{token}.json' in log
                assert progress['step'] == ('failed' if fail_migration else 'done'), progress
                assert (folder / 'started').read_text() == (('// ' if real_pm2 else '') + ('old-code' if fail_migration else 'new-code'))
                assert any(request.startswith(('SQL:', 'POSTGRES_SQL:')) for request in requests), requests
                if not installed_source and not real_pm2:
                    values = (folder / 'pm2-environment').read_text().splitlines()
                    assert values[:2] == ['$(echo changed)', 'a b = c'], values
                    assert json.loads(values[2])[0]['templateId'] == 'fixture'
            assert not list(runtime.glob('*.lock')), 'lock leaked'
            if 'flock' in str(shutil.which('flock')) and delegated:
                assert 'Inherited updater lock' in log, log
            print(json.dumps({'case': name, 'exit': run.returncode, 'delegated': delegated, 'step': progress['step'], 'stderr': run.stderr.strip(), 'migration_version': migration_version, 'real_rpc': real_rpc, 'requests': requests}), flush=True)
            results.append(name)
        finally:
            if real_pm2:
                subprocess.run([real_pm2_bin, 'kill'], env={**os.environ, **pm2_environment}, capture_output=True, timeout=15)
            server.shutdown()
            server.server_close()
            thread.join()

    case('downloaded-stage2')
    case('bad-signature', bad_signature=True)
    case('bad-checksum', bad_checksum=True)
    case('legacy-fallback', stage2=False)
    case('minimum-too-new', minimum=3)
    case('minimum-supported', minimum=2)
    case('stage2-migration-rollback', fail_migration=True)
    if legacy:
        case('unmodified-4982c3de', installed_source=legacy)
    if os.environ.get('BOOTSTRAP_REAL_PM2') == '1':
        case('real-pm2', real_pm2=True, real_rpc=bool(os.environ.get('BOOTSTRAP_REAL_RPC_CONFIG')))
    if legacy and os.environ.get('BOOTSTRAP_REAL_RPC_CONFIG'):
        case('4982c3de-real-postgres', installed_source=legacy, real_rpc=True)
print('PASS ' + str(len(results)) + ' full updater cases')
