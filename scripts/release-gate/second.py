import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request

from support import (
    CLI,
    RELEASE_LOOKUP_TOKEN,
    OUT,
    ROOT,
    RUNTIME,
    STACK,
    TOOLS,
    assert_no_stacks,
    clean,
    configure,
    env,
    record,
    require,
    run,
    validate_release_version,
    write_env,
)
from diagnostics import public_message, verify_vitest, vitest_report_path

# Mac r29 ran the matrix in 149 s, GHA reached its last build in 7 min; a hung step must not eat the 90-minute job.
MATRIX_TIMEOUT = 30 * 60
from first import reset


def image_checks():
    image = (
        'sellf:' + validate_release_version(json.loads((ROOT / 'package.json').read_text())['version']) + '-big-gate'
    )
    run('release-layout', ['python3', str(TOOLS / 'contracts.py')])
    run('docker', ['docker', 'build', '--no-cache-filter', 'runner', '-t', image, '.'])
    try:
        image_id = subprocess.check_output(
            ['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True
        ).strip()
        (OUT / 'image-id.txt').write_text(image_id + '\n')
    except subprocess.CalledProcessError as e:
        record('image-id', 1, error=type(e).__name__)
    run(
        'trivy',
        [
            'trivy',
            'image',
            '--scanners',
            'vuln',
            '--severity',
            'HIGH,CRITICAL',
            '--cache-dir',
            str(OUT / 'trivy-cache'),
            '--format',
            'json',
            '--output',
            str(OUT / 'trivy.json'),
            image,
        ],
    )
    try:
        scan = json.loads((OUT / 'trivy.json').read_text())
        vs = [v for r in scan.get('Results', []) for v in r.get('Vulnerabilities', [])]
        summary = {
            'critical': [v for v in vs if v['Severity'] == 'CRITICAL'],
            'fixableHigh': [v for v in vs if v['Severity'] == 'HIGH' and v.get('FixedVersion')],
            'unfixedHigh': [v for v in vs if v['Severity'] == 'HIGH' and not v.get('FixedVersion')],
        }
        (OUT / 'trivy-criterion.json').write_text(json.dumps(summary, indent=2))
        record(
            'trivy-criterion',
            int(bool(summary['critical'] or summary['fixableHigh'])),
            critical=len(summary['critical']),
            fixableHigh=len(summary['fixableHigh']),
            unfixedHigh=len(summary['unfixedHigh']),
        )
    except Exception as e:
        record('trivy-criterion', 1, error=type(e).__name__)
    # Smoke only this task-owned image container; no external configuration writes.
    s = env
    smoke = OUT / 'smoke.env'
    values = {
        'NODE_ENV': 'production',
        'SITE_URL': 'http://localhost:55331',
        'SUPABASE_URL': 'http://host.docker.internal:55321',
        'PUBLIC_SUPABASE_URL': 'http://127.0.0.1:55321',
        'SUPABASE_ANON_KEY': s['SUPABASE_ANON_KEY'],
        'SUPABASE_SERVICE_ROLE_KEY': s['SUPABASE_SERVICE_ROLE_KEY'],
        'TRUSTED_PROXY': 'true',
        'SELLF_TELEMETRY_DISABLED': 'true',
        'CHECKOUT_BINDING_SECRET': s['CHECKOUT_BINDING_SECRET'],
        'LOGINWALL_SECRET': s['LOGINWALL_SECRET'],
        'ALTCHA_HMAC_KEY': s['ALTCHA_HMAC_KEY'],
        'APP_ENCRYPTION_KEY': s['APP_ENCRYPTION_KEY'],
    }
    write_env(smoke, values)
    try:
        rc = run(
            'image-smoke-start',
            [
                'docker',
                'run',
                '-d',
                '--name',
                'sellf-rcgate-image-smoke',
                '--add-host=host.docker.internal:host-gateway',
                '-p',
                '127.0.0.1:55331:3000',
                '--env-file',
                str(smoke),
                image,
            ],
        )
        if rc == 0:
            for _ in range(60):
                try:
                    if urllib.request.urlopen('http://localhost:55331/api/health', timeout=2).status == 200:
                        break
                except Exception:
                    pass
                time.sleep(1)
            checks = {}
            for path in ['/', '/api/health', '/login']:
                try:
                    checks[path] = urllib.request.urlopen('http://localhost:55331' + path, timeout=20).status
                except Exception as e:
                    checks[path] = str(e)
            (OUT / 'image-smoke-http.json').write_text(json.dumps(checks))
            record('image-smoke-http', int(any(v != 200 for v in checks.values())), checks=checks)
            run(
                'image-runtime-contract',
                [
                    'docker',
                    'exec',
                    'sellf-rcgate-image-smoke',
                    'node',
                    '-e',
                    "const fs=require('fs');console.log(process.version);if(!process.version.startsWith('v22.')||!fs.existsSync('/app/server.js')||fs.existsSync('/usr/local/lib/node_modules/npm')||fs.existsSync('/usr/local/lib/node_modules/corepack'))process.exit(1)",
                ],
            )
    finally:
        run('image-smoke-stop', ['docker', 'rm', '-f', 'sellf-rcgate-image-smoke'])
        smoke.unlink(missing_ok=True)


def docs_and_playerstack():
    docs = OUT / 'docs-site'
    shutil.copytree(
        ROOT / 'docs-site', docs, ignore=shutil.ignore_patterns('node_modules', 'dist', '.astro'), dirs_exist_ok=True
    )
    run('docs-install', ['bun', 'install', '--frozen-lockfile'], docs)
    run('docs-build', ['bun', 'run', 'build'], docs)
    # Pinned Playerstack rebuild (gate-owned clone, Bun 1.4.3 as in CI); every vendored module must match the rebuild.
    pin = re.search(
        r"PLAYERSTACK_COMMIT_SHA = '([a-f0-9]{40})'", (ROOT / 'admin-panel/src/lib/playerstack.ts').read_text()
    )[1]
    ps = OUT / 'playerstack'
    ps.mkdir()
    player_source = OUT / 'playerstack-src.git'
    require(
        'playerstack-source',
        [
            'git',
            'clone',
            '--bare',
            '--filter=blob:none',
            'https://github.com/jurczykpawel/playerstack.git',
            str(player_source),
        ],
    )
    raw = subprocess.check_output(['git', '-C', str(player_source), 'archive', pin], env=env, stderr=subprocess.DEVNULL)
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        tar.extractall(ps, filter='data')
    bun143 = env['RC_GATE_PLAYERSTACK_BUN']
    assert subprocess.check_output([bun143, '--version'], text=True).strip() == '1.4.3'
    bun_env = {'PATH': str(Path(bun143).parent) + os.pathsep + env['PATH']}
    run('playerstack-install', [bun143, 'install', '--frozen-lockfile'], ps, bun_env)
    run('playerstack-build', [bun143, 'run', 'build'], ps / 'packages/embed', bun_env)
    source = (ROOT / 'admin-panel/src/lib/playerstack.ts').read_text()
    declared = re.search(r'sha384-[A-Za-z0-9+/=]+', source)[0]
    rel = re.search(r"'/vendor/[^']+'", source)[0][1:-1]

    def sri(p):
        return 'sha384-' + base64.b64encode(hashlib.sha384(p.read_bytes()).digest()).decode()

    try:
        vdir = (ROOT / ('admin-panel/public' + rel)).parent
        dist = ps / 'packages/embed/dist'
        mods = [
            line.strip()
            for line in (ROOT / 'admin-panel/scripts/playerstack-modules.txt').read_text().splitlines()
            if line.strip() and not line.lstrip().startswith('#')
        ]
        pairs = [(dist / f, vdir / f) for m in mods for f in (m, m + '.LEGAL.txt')] + [
            (ps / f, vdir / f) for f in ('LICENSE', 'NOTICE')
        ]
        mismatched = [
            str(b.relative_to(vdir))
            for a, b in pairs
            if not (a.is_file() and b.is_file() and a.read_bytes() == b.read_bytes())
        ]
        v = sri(vdir / 'playerstack.min.js')
        (OUT / 'playerstack-sri.json').write_text(
            json.dumps(
                {
                    'pin': pin,
                    'declared': declared,
                    'vendored': v,
                    'dirMatchesPin': vdir.name == pin[:7],
                    'files': len(pairs),
                    'mismatched': mismatched,
                },
                indent=2,
            )
        )
        record(
            'playerstack-sri',
            int(v != declared or vdir.name != pin[:7] or bool(mismatched)),
            files=len(pairs),
            mismatched=mismatched,
        )
    except Exception as e:
        record('playerstack-sri', 1, error=type(e).__name__)


def deployment_matrix():
    clean()
    require('upgrade-owned-stop', [CLI, 'stop', '--no-backup', '--workdir', str(STACK)])
    assert_no_stacks()
    shutil.rmtree(ROOT / 'admin-panel/.next/dev/cache', ignore_errors=True)
    # The frozen candidate invokes npx supabase; use the CLI already pinned by the job.
    shim = OUT / 'upgrade-bin'
    shim.mkdir()
    npx = shim / 'npx'
    npx.write_text('#!/bin/sh\n[ "$1" = supabase ] || exit 2\nshift\nexec "$SUPABASE_CLI_BINARY_OVERRIDE" "$@"\n')
    npx.chmod(0o700)
    run(
        'upgrade-data',
        ['bash', 'scripts/upgrade-data-test.sh'],
        ROOT / 'admin-panel',
        {
            'PATH': str(shim) + os.pathsep + env['PATH'],
            'SUPABASE_AUTH_JWT_SECRET': 'env(RC_GATE_UPGRADE_JWT_SECRET)',
            'UPGRADE_TEST_PROJECT': 'sellf-upg',
            'UPGRADE_TEST_PORT_BASE': '55570',
            'UPGRADE_TEST_APP_PORT': '55581',
            'SUPABASE_DB_CONTAINER': 'supabase_db_sellf-upg',
            'PUBLIC_SUPABASE_URL': 'http://127.0.0.1:55571',
            'NEXT_PUBLIC_BASE_URL': 'http://localhost:55581',
            'NEXT_PUBLIC_APP_URL': 'http://localhost:55581',
        },
    )
    assert_no_stacks()
    require('upgrade-owned-restart', [CLI, 'start', '--workdir', str(STACK)])
    configure()
    reset('matrix-reset', 'matrix-kong')
    code = run(
        'matrix',
        ['bun', str(RUNTIME / 'upgrade-matrix-runner.ts'), '--stack=' + str(STACK)],
        ROOT / 'admin-panel',
        {'RC_GATE_VITEST_REPORT': str(vitest_report_path('matrix-vitest')), 'RC_GATE_GITHUB_TOKEN': RELEASE_LOOKUP_TOKEN},
        timeout=MATRIX_TIMEOUT,
    )
    if code:
        # The runner's progress lines are its own fixed strings plus a command verb.
        lines = (OUT / 'matrix.log').read_text(errors='replace').splitlines()
        steps = [public_message(line) for line in lines if re.match(r'(?:STEP|PASS|STEP-TIMEOUT) |\w*Error\b', line)][-8:]
        record('matrix-progress', 0, steps=steps)
    verify_vitest('matrix-vitest')


def source_checks():
    run(
        'secret-scan',
        [
            'trufflehog',
            'git',
            'file://.',
            '--since-commit',
            'v2026.10.5',
            '--config',
            '.trufflehog-config.yaml',
            '--results=verified,unknown',
            '--fail',
        ],
    )
    run('diff-check', ['git', 'diff', '--check'])
