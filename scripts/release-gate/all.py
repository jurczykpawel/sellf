"""Run one isolated gate lane and publish only structured stage receipts."""

import importlib.util
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request

from browser import FAKE_STRIPE, LANES, repeat_arguments, run_browser, run_repeat
from freeze import frozen_source
from prepare import prepare_stack
from support import (
    ADMIN,
    CLI,
    OUT,
    RECEIPT,
    RELEASE_LOOKUP_TOKEN,
    ROOT,
    RUNTIME,
    STACK,
    TOOLS,
    assert_no_stacks,
    configure,
    env,
    generate_credentials,
    mask,
    record,
    redact,
    require,
    resolve_gate_head,
    run,
    validate_release_version,
)
from diagnostics import public_message
from verify_coverage import inventory

AUXILIARY = ('unit', 'database', 'api', 'historical-upgrade', 'second')


def matrix(protected):
    # only_spec: one diagnostic lane that repeats the named specs (never a gate result, no Stripe lanes).
    if os.environ.get('RC_GATE_ONLY_SPEC'):
        return {'lane': [] if protected else ['repeat']}
    return {'lane': [n for n in (*AUXILIARY, *LANES) if n.startswith('stripe-') == protected]}


def output(name, value):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
        file.write(f'{name}={value}\n')


def resolve_candidate(ref, workflow_sha):
    if re.fullmatch(r'[0-9a-f]{40}', ref):
        revision = ref
    else:
        assert ref.startswith(('refs/heads/', 'refs/tags/')), 'Use a full commit SHA or full Git ref'
        subprocess.run(['git', 'check-ref-format', ref], check=True, capture_output=True)
        revision = ref.replace('refs/heads/', 'refs/remotes/origin/', 1) if ref.startswith('refs/heads/') else ref
    repository = TOOLS.parents[1]
    sha = subprocess.check_output(
        ['git', 'rev-parse', '--verify', revision + '^{commit}'], cwd=repository, text=True, stderr=subprocess.DEVNULL
    ).strip()
    result = subprocess.run(
        ['git', 'merge-base', '--is-ancestor', sha, workflow_sha], cwd=repository, capture_output=True
    )
    assert result.returncode == 0, 'Candidate must be the workflow commit or one of its ancestors'
    return sha


def stage_browser_tools():
    RUNTIME.mkdir()
    for item in TOOLS.iterdir():
        if item.suffix in ('.ts', '.mjs'):
            shutil.copyfile(item, RUNTIME / item.name)
    (RUNTIME / 'node_modules').symlink_to(ADMIN / 'node_modules', target_is_directory=True)
    (RUNTIME / 'admin').symlink_to(ADMIN, target_is_directory=True)


UPDATE_SNAPSHOTS = os.environ.get('RC_GATE_UPDATE_SNAPSHOTS') == 'true'


def prepare_sections():
    # storefront-theme reads fonts from the production CSS chunks; on the Mac an earlier lane had built them.
    require('build-admin', ['bun', 'run', 'build'], ADMIN)
    # Screenshot baselines in the candidate are macOS renders; Linux ones live with the harness (see linux-snapshots/).
    snapshots = OUT / 'linux-snapshots' if UPDATE_SNAPSHOTS else TOOLS / 'linux-snapshots'
    env['RC_GATE_SNAPSHOT_DIR'] = str(snapshots)
    if UPDATE_SNAPSHOTS:
        env['RC_GATE_SNAPSHOT_UPDATE'] = 'all'


def stripe_environment():
    key = os.environ.get('STRIPE_SANDBOX_SECRET_KEY', '')
    public = os.environ.get('STRIPE_SANDBOX_PUBLISHABLE_KEY', '')
    account_id = os.environ.get('STRIPE_SANDBOX_ACCOUNT_ID', '')
    assert re.fullmatch('sk_' + r'test_[A-Za-z0-9]+', key), 'Candidate test runner requires a Stripe sandbox secret'
    assert re.fullmatch('pk_' + r'test_[A-Za-z0-9]+', public), 'Set the Stripe sandbox publishable key'
    assert re.fullmatch(r'acct_[A-Za-z0-9]+', account_id), 'Set the dedicated sandbox account ID'
    mask(key)
    mask(public)
    request = urllib.request.Request('https://api.stripe.com/v1/account', headers={'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert json.load(response)['id'] == account_id, 'Stripe account differs from the dedicated sandbox'
    env.update(STRIPE_SECRET_KEY=key, STRIPE_PUBLISHABLE_KEY=public, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=public)
    raw = subprocess.check_output(
        ['stripe', 'listen', '--print-secret'],
        env={**env, 'STRIPE_API_KEY': key},
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=45,
    ).strip()
    assert re.fullmatch('wh' + r'sec_[A-Za-z0-9]+', raw), 'Stripe CLI returned no webhook secret'
    mask(raw)
    env['STRIPE_WEBHOOK_SECRET'] = raw


def candidate_stack():
    assert_no_stacks()
    prepare_stack(STACK)
    record('prepare-source-stack', 0)
    if run('start', [CLI, 'start', '--workdir', str(STACK)], retried=True):
        # Runner-side start failures happen (GHA 45608564708, chromium-2of6): publish the CLI's last line, retry once.
        lines = [line for line in (OUT / 'start.log').read_text(errors='replace').splitlines() if line.strip()]
        record('start-error', 0, steps=[public_message(line) for line in lines[-4:]])
        run('start-reset', [CLI, 'stop', '--no-backup', '--workdir', str(STACK)])
        # `stop` cannot clean a stack that never registered; remove this project's leftovers before retrying.
        names = subprocess.run(['docker', 'ps', '-aq', '--filter', 'name=_sellf-rcgate'], capture_output=True, text=True).stdout.split()
        if names:
            run('start-leftovers', ['docker', 'rm', '-f', '-v', *names])
        time.sleep(30)
        require('start-retry', [CLI, 'start', '--workdir', str(STACK)])
    configure()


def describe_error(error):
    """Public receipt text: assertion messages are the harness's own fixed strings, so they are published
    (redacted, max 190 chars) to make GHA failures diagnosable; any other exception stays a type name."""
    if not isinstance(error, AssertionError) or not error.args:
        return type(error).__name__
    text = redact(str(error.args[0]))
    return ('AssertionError: ' + ' '.join(text.split()))[:190]


def execute(lane):
    from first import api, database, reset, stripe_unit, unit
    from tools_linux import install

    assert subprocess.check_output(['bun', '--version'], text=True).strip() == '1.3.14', 'Unexpected Bun version'
    if lane != 'inventory':
        pin = re.search(r"PINNED_SUPABASE_CLI = '([^']+)'", (ADMIN / 'scripts/schema-snapshot.ts').read_text())[1]
        assert subprocess.check_output([CLI, '--version'], stderr=subprocess.DEVNULL, text=True).strip() == pin, (
            'Unexpected Supabase CLI version'
        )

    if lane == 'historical-upgrade':
        spec = importlib.util.spec_from_file_location('historical_upgrade', TOOLS / 'historical-upgrade.py')
        historical = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(historical)
        historical.main()
        return

    require('install-admin', ['bun', 'install', '--frozen-lockfile'], ADMIN)
    if lane == 'inventory':
        stage_browser_tools()
        result = inventory()
        output('inventory', json.dumps(result, separators=(',', ':')))
        return
    if lane in LANES or lane in ('second', 'unit', 'repeat'):  # unit: affiliate browser tests launch Chromium
        stage_browser_tools()
        require('install-chromium', ['bun', 'x', 'playwright', 'install', '--with-deps', 'chromium'], ADMIN)

    candidate_stack()
    if lane == 'unit':
        unit()
    elif lane == 'database':
        database()
    elif lane == 'api':
        api()
    elif lane == 'second':
        import second

        install('trivy', 'trufflehog', 'playerstack-bun')
        second.image_checks()
        second.docs_and_playerstack()
        second.deployment_matrix()
        second.source_checks()
    else:
        if lane.startswith('stripe-'):
            install('stripe', 'cloudflared') if lane == 'stripe-live' else install('stripe')
            stripe_environment()
            if lane == 'stripe-live':
                reset('stripe-reset', 'stripe-kong')
        elif lane.startswith('chromium'):
            install('cloudflared')  # signed-delivery specs (J71, J560) reach their receivers through a public tunnel
        elif lane == 'sections':
            prepare_sections()
        elif lane == 'repeat':
            install('cloudflared')
            run_repeat(os.environ['RC_GATE_ONLY_SPEC'], os.environ['RC_GATE_REPEAT_EACH'])
            return
        for suite in LANES[lane]:
            run_browser(suite, json.loads(os.environ['RC_GATE_INVENTORY'])['counts'])
        if lane == 'sections' and UPDATE_SNAPSHOTS:
            record('snapshot-update-mode', 1)  # a baseline-generation run is never a gate result
        if lane == 'stripe-runtime':
            stripe_unit()


def run_lane(lane):
    assert lane in (*AUXILIARY, *LANES, 'inventory', 'repeat'), 'Unknown gate lane'
    assert os.environ.get('RUNNER_OS') == 'Linux' and os.environ.get('GITHUB_ACTIONS') == 'true', (
        'GitHub Linux runner required'
    )
    assert not OUT.exists(), 'Gate scratch space must be fresh'
    app_env = ADMIN / '.env.local'
    assert not app_env.exists() and not app_env.is_symlink(), 'Expected a fresh checkout'
    OUT.mkdir(mode=0o700)
    started = time.monotonic()
    head = resolve_gate_head(expected=os.environ['RC_GATE_SHA'])
    version = validate_release_version(json.loads((ROOT / 'package.json').read_text())['version'])
    record('final-begin', 0, lane=lane, head=head, version=version)
    if RELEASE_LOOKUP_TOKEN:
        mask(RELEASE_LOOKUP_TOKEN)
    env['RC_GATE_ROOT'] = str(ROOT)
    env.update(FAKE_STRIPE)
    env['STRIPE_WEBHOOK_SECRET'] = 'wh' + 'sec_' + secrets.token_hex(32)
    mask(env['STRIPE_WEBHOOK_SECRET'])
    generate_credentials()
    before = None
    try:
        before = frozen_source()
        execute(lane)
    except Exception as error:
        record('lane-error', 1, error=describe_error(error))
    finally:
        try:
            spec = importlib.util.spec_from_file_location('final_cleanup', TOOLS / 'final-cleanup.py')
            cleanup = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cleanup)
            cleanup.cleanup(remove_app_env=True)
            record('freeze-after-cleanup', int(before is None or frozen_source() != before))
        except Exception as error:
            record('cleanup-or-freeze', 1, error=type(error).__name__)
        failures = [row['name'] for row in map(json.loads, RECEIPT.read_text().splitlines()) if row['exit']]
    return record(
        'final-end',
        int(bool(failures)),
        lane=lane,
        head=head,
        seconds=round(time.monotonic() - started, 1),
        failures=failures,
    )


def aggregate(results, expected_inventory, statuses):
    successful = {'preflight', 'inventory', 'checks', 'stripe'}
    expected = {suite.name for suites in LANES.values() for suite in suites}
    counts = expected_inventory.get('counts', {})
    inventory_ok = (
        set(counts) == expected
        and all(type(count) is int and count > 0 for count in counts.values())
        and sum(counts.values()) == sum(expected_inventory.get('totals', {}).values())
    )
    failures = [name for name in sorted(successful) if statuses.get(name, {}).get('result') != 'success']
    if not inventory_ok:
        failures.append('playwright-coverage')
    return record(
        'final-end',
        int(bool(failures)),
        head=results,
        failures=failures,
        testsByConfig=expected_inventory.get('totals', {}),
    )


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'preflight':
        if os.environ.get('RC_GATE_ONLY_SPEC'):
            repeat_arguments(os.environ['RC_GATE_ONLY_SPEC'], os.environ['RC_GATE_REPEAT_EACH'])
        workflow_sha = resolve_gate_head(TOOLS.parents[1], os.environ['GITHUB_SHA'])
        output('sha', resolve_candidate(os.environ['RC_GATE_REF'], workflow_sha))
        output('checks', json.dumps(matrix(False), separators=(',', ':')))
        output('stripe', json.dumps(matrix(True), separators=(',', ':')))
    elif command == 'aggregate':
        raise SystemExit(
            aggregate(
                os.environ['RC_GATE_SHA'],
                json.loads(os.environ['RC_GATE_INVENTORY'] or '{}'),
                json.loads(os.environ['RC_GATE_STATUSES']),
            )
        )
    else:
        raise SystemExit(run_lane(command))
