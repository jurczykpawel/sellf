"""Runner-local paths, credentials, and stage receipts."""

import base64
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import tempfile
import time

TOOLS = Path(__file__).resolve().parent
ROOT = Path(os.environ.get('RC_GATE_ROOT', TOOLS.parents[1])).resolve()
ADMIN = ROOT / 'admin-panel'
RUNNER_TEMP = Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir()))
OUT = Path(os.environ.get('RC_GATE_OUT', RUNNER_TEMP / 'release-gate'))
STACK = OUT / 'stack'
RUNTIME = OUT / 'tools'
RECEIPT = OUT / 'public' / 'results.jsonl'
CLI = shutil.which('supabase') or 'supabase'
env = {
    **os.environ,
    'SUPABASE_CLI_BINARY_OVERRIDE': CLI,
    'SUPABASE_TELEMETRY_DISABLED': '1',
    'NEXT_TELEMETRY_DISABLED': '1',
    'SELLF_TELEMETRY_DISABLED': 'true',
    'NODE_OPTIONS': '--max-old-space-size=4096',
    'PYTHONDONTWRITEBYTECODE': '1',
}
for name in (
    'STRIPE_SANDBOX_SECRET_KEY',
    'STRIPE_SANDBOX_PUBLISHABLE_KEY',
    'STRIPE_SANDBOX_ACCOUNT_ID',
    'GITHUB_ENV',
    'GITHUB_OUTPUT',
    'GITHUB_PATH',
    'GITHUB_STEP_SUMMARY',
    'GITHUB_STATE',
):
    env.pop(name, None)


def mask(value):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        assert value and not re.search(r'[\r\n]', value), 'Expected a single-line credential'
        print('::add-mask::' + value.replace('%', '%25'), flush=True)


def record(name, code, **data):
    entry = {'name': name, 'exit': code, **data}
    line = json.dumps(entry, separators=(',', ':'))
    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    with RECEIPT.open('a') as file:
        file.write(line + '\n')
    print('RESULT ' + line, flush=True)
    return code


def run(name, cmd, cwd=ROOT, extra=None, stdin=None, stdout=None):
    print(f'START {name}', flush=True)
    start = time.monotonic()
    code = 1
    try:
        with (OUT / (name + '.log')).open('w') as log:
            with subprocess.Popen(
                cmd,
                cwd=cwd,
                env={**env, **(extra or {})},
                stdout=stdout or log,
                stderr=log if stdout else subprocess.STDOUT,
                stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                text=True,
                start_new_session=True,
            ) as child:
                try:
                    child.communicate(stdin)
                    code = child.returncode
                finally:
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(child.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
    except OSError:
        pass
    return record(name, code, seconds=round(time.monotonic() - start, 1))


def require(name, *args, **kwargs):
    if run(name, *args, **kwargs):
        raise RuntimeError(name)


def resolve_gate_head(root=ROOT, expected=None):
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert expected is None or expected == actual, 'HEAD differs from candidate SHA'
    return actual


def validate_release_version(version):
    assert re.fullmatch(r'2026\.11\.1(?:-rc\.[1-9][0-9]*)?', version), 'Expected 2026.11.1 or 2026.11.1-rc.N'
    return version


def generate_credentials():
    values = {
        key: secrets.token_hex(32)
        for key in (
            'CHECKOUT_BINDING_SECRET',
            'LOGINWALL_SECRET',
            'ALTCHA_HMAC_KEY',
            'CRON_SECRET',
            'RC_GATE_SUPABASE_JWT_SECRET',
            'RC_GATE_UPGRADE_JWT_SECRET',
        )
    }
    values['RC_GATE_SUPABASE_PUBLISHABLE_KEY'] = 'sb_publishable_' + secrets.token_urlsafe(32)
    values['RC_GATE_SUPABASE_SECRET_KEY'] = 'sb_secret_' + secrets.token_urlsafe(32)
    values['RC_GATE_MATRIX_API_KEY'] = 'sf_live_' + secrets.token_hex(32)
    values['RC_GATE_MATRIX_ADMIN_PASSWORD'] = secrets.token_hex(24)
    values['APP_ENCRYPTION_KEY'] = base64.b64encode(secrets.token_bytes(32)).decode()
    for value in values.values():
        mask(value)
    env.update(values)


def stack_status():
    status = json.loads(
        subprocess.check_output(
            [CLI, 'status', '--workdir', str(STACK), '-o', 'json'], cwd=ROOT, env=env, stderr=subprocess.DEVNULL
        )
    )
    assert status['API_URL'] == 'http://127.0.0.1:55321'
    assert status['JWT_SECRET'] == env['RC_GATE_SUPABASE_JWT_SECRET'], 'Unexpected stack JWT configuration'
    assert status['SECRET_KEY'] == env['RC_GATE_SUPABASE_SECRET_KEY'], 'Unexpected stack API key configuration'
    for key in ('ANON_KEY', 'SERVICE_ROLE_KEY', 'PUBLISHABLE_KEY', 'SECRET_KEY', 'JWT_SECRET'):
        if status.get(key):
            mask(status[key])
    return status


def configure():
    status = stack_status()
    updates = dict.fromkeys(
        ('SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'OFFER_TEST_SUPABASE_URL'),
        status['API_URL'],
    )
    updates.update(
        dict.fromkeys(('SUPABASE_ANON_KEY', 'ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'), status['ANON_KEY'])
    )
    updates.update(dict.fromkeys(('SUPABASE_SERVICE_ROLE_KEY', 'OFFER_TEST_SERVICE_KEY'), status['SERVICE_ROLE_KEY']))
    updates.update(
        dict.fromkeys(
            ('SITE_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL'), 'http://localhost:3777'
        )
    )
    updates.update(
        SUPABASE_DB_CONTAINER='supabase_db_sellf-rcgate',
        MAILPIT_URL='http://127.0.0.1:55324',
        SUPABASE_TEST_WORKDIR=str(STACK),
        TRUSTED_PROXY='true',
        DEMO_MODE='false',
        STRIPE_COLLECT_TERMS_OF_SERVICE='false',
        SUPABASE_KEEP_ALIVE='false',
    )
    env.update(updates)
    # The Stripe runner and some test helpers load dotenv themselves.
    write_env(
        ADMIN / '.env.local',
        updates
        | {
            key: env[key]
            for key in (
                'APP_ENCRYPTION_KEY',
                'ALTCHA_HMAC_KEY',
                'CRON_SECRET',
                'CHECKOUT_BINDING_SECRET',
                'LOGINWALL_SECRET',
            )
        },
    )
    write_env(OUT / 'affiliates.env', updates)


def write_env(path, values):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.writelines(f'{key}={value}\n' for key, value in values.items())


def assert_no_stacks():
    names = subprocess.check_output(['docker', 'ps', '--format', '{{.Names}}'], text=True, env=env).splitlines()
    assert not any(name.startswith('supabase_db_') for name in names), 'Unexpected local Supabase stack'


def clean():
    for port in (3777, 3778, 3779, 3789, 55331):
        listing = subprocess.run(['lsof', '-tiTCP:' + str(port), '-sTCP:LISTEN'], capture_output=True, text=True)
        assert listing.returncode in (0, 1), f'Cannot inspect port {port}'
        assert not listing.stdout.strip(), f'Port {port} is occupied'
