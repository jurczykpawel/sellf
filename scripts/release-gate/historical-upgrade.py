"""Disposable v2026.11.0 -> candidate database upgrade via the updater's batch builder.

Not the production-backup/Linux bootstrap rehearsal: that remains a separate release proof.
@see contracts.py and admin-panel/scripts/upgrade.sh
"""

import hashlib
import io
import json
import shutil
import subprocess
import tarfile
import urllib.request

from support import CLI, OUT, ROOT, STACK, assert_no_stacks, env, record, require, resolve_gate_head, stack_status
from prepare import prepare_stack

BASELINE = 'v2026.11.0'
MIGRATION = '20261118000000_release_2026_11_1'


def build_batch(output):
    updater = (ROOT / 'admin-panel/scripts/upgrade.sh').read_text()
    start = updater.index('build_migration_batch() {')
    end = updater.index('\n}\n', start) + 3
    # Run the actual candidate function, never a Python reimplementation of its SQL.
    script = (
        'set -euo pipefail\n' + updater[start:end] + '\nlog() { echo "$@" >&2; }\nbuild_migration_batch "$1" "$2"\n'
    )
    subprocess.run(
        ['bash', '-s', '--', str(output), MIGRATION],
        input=script,
        text=True,
        env={**env, 'INSTALL_DIR': str(ROOT)},
        check=True,
    )


def sql(source):
    return subprocess.check_output(
        [
            'docker',
            'exec',
            '-i',
            'supabase_db_sellf-rcgate',
            'psql',
            '-X',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-At',
            '-v',
            'ON_ERROR_STOP=1',
        ],
        input=source,
        text=True,
        env=env,
    ).strip()


def main():
    assert_no_stacks()
    assert not STACK.exists(), 'Historical upgrade needs a fresh owned stack directory'
    prepare_stack(STACK)
    # Keep the isolated candidate config, but use ONLY the released migrations/templates/seed.
    archive = subprocess.check_output(['git', 'archive', BASELINE, 'supabase'], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
        for directory in ['migrations', 'templates']:
            shutil.rmtree(STACK / 'supabase' / directory, ignore_errors=True)
        for member in contents.getmembers():
            if member.name == 'supabase/config.toml':
                continue
            contents.extract(member, STACK, filter='data')
    started = False
    try:
        started = True
        require('historical-start', [CLI, 'start', '--workdir', str(STACK)])
        require(
            'historical-ready',
            ['python3', '-B', str(ROOT / 'supabase/tests/local_stack.py'), 'ready', str(STACK)],
            extra={'SUPABASE_URL': 'http://127.0.0.1:55321', 'SUPABASE_DB_CONTAINER': 'supabase_db_sellf-rcgate'},
        )
        status = stack_status()
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261118000000'") == '0'
        assert sql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user") == 'f'
        tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()

        def counts():
            return {name: sql('SELECT count(*) FROM public."' + name.replace('"', '""') + '"') for name in tables}

        before = counts()
        batch = OUT / 'historical-batch.sql'
        build_batch(batch)
        source = batch.read_text()

        def apply(source):
            payload = {
                'migration_version': MIGRATION,
                'migration_sql': source,
                'content_checksum': hashlib.sha256(source.encode()).hexdigest(),
            }
            request = urllib.request.Request(
                status['API_URL'] + '/rest/v1/rpc/apply_migration',
                json.dumps(payload).encode(),
                headers={
                    'apikey': status['SERVICE_ROLE_KEY'],
                    'Authorization': 'Bearer ' + status['SERVICE_ROLE_KEY'],
                    'Content-Type': 'application/json',
                },
            )
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.load(response)

        result = apply(source)
        assert result.get('success') is True and result.get('skipped') is False, result
        repeated = apply(source)
        assert repeated.get('success') is True and repeated.get('skipped') is True, repeated
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261118000000'") == '1'
        after = counts()
        differences = {
            name: {'before': before[name], 'after': after[name]} for name in tables if before[name] != after[name]
        }
        # 11.1 may intentionally add dictionary/configuration rows; financial/access rows must survive.
        retained = [
            'products',
            'profiles',
            'payment_transactions',
            'payment_line_items',
            'user_product_access',
            'guest_purchases',
            'subscriptions',
            'coupons',
        ]
        assert all(before[name] == after[name] for name in retained), differences
        record(
            'historical-11-0-to-11-1',
            0,
            baseline=BASELINE,
            head=resolve_gate_head(expected=env.get('RC_GATE_SHA')),
            migration=MIGRATION,
            sqlBytes=batch.stat().st_size,
            repeatSkipped=True,
            countsBefore=before,
            countsAfter=after,
            changedCounts=differences,
        )
    finally:
        if started:
            require(
                'historical-owned-stop',
                [CLI, 'stop', '--project-id', 'sellf-rcgate', '--no-backup', '--workdir', str(STACK)],
            )


if __name__ == '__main__':
    main()
