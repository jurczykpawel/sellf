import shutil
import sys

from diagnostics import run_vitest, verify_vitest, vitest_report_path
from support import ADMIN, CLI, OUT, ROOT, STACK, clean, require, run


def unit():
    reset('reset', 'kong')
    run(
        'local-stack-unit',
        ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'supabase/tests', '-p', 'test_local_stack.py'],
    )
    run('migration-lint', ['bun', 'run', 'lint:migrations'], ROOT / 'admin-panel')
    run_vitest(
        'return-path-focused',
        [
            'bun',
            'x',
            'vitest',
            'run',
            'tests/unit/security/open-redirect.test.ts',
            'tests/unit/security/auth-security.test.ts',
            'tests/unit/payment-status-redirect.test.ts',
            'tests/unit/auth/callback-pending-grants.test.ts',
            'tests/unit/auth/magic-link-route.test.ts',
            'tests/unit/auth/return-destinations.test.ts',
            'tests/unit/auth/magic-link-request.test.ts',
            'tests/unit/security/magic-link-redirect-url.test.ts',
        ],
    )
    run_vitest('unit', ['bun', 'run', 'tt'])
    shutil.rmtree(ROOT / 'admin-panel/.next/types', ignore_errors=True)
    for name, cmd, cwd in [
        ('typecheck-admin', ['bun', 'run', 'typecheck'], 'admin-panel'),
        ('lint', ['bun', 'run', 'lint'], 'admin-panel'),
        (
            'audit-admin',
            ['bun', 'audit', '--audit-level=high', '--ignore=GHSA-vfj7-8cjw-p6xm', '--ignore=GHSA-fc5q-39xc-vjpf'],
            'admin-panel',
        ),
    ]:
        run(name, cmd, ROOT / cwd)


def database():
    sys.path.insert(0, str(ROOT / 'supabase/tests'))
    from migration_source import read_migration_source

    reset('reset', 'kong')
    run('db-lint', [CLI, 'db', 'lint', '--local', '--workdir', str(STACK)])
    for sql in sorted((ROOT / 'supabase/tests').glob('*.sql')):
        script = sql.read_text()
        cmd = [
            'docker',
            'exec',
            '-i',
            'supabase_db_sellf-rcgate',
            'psql',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-v',
            'ON_ERROR_STOP=1',
        ]
        if sql.stem in ['storefront-perf-fixture', 'storefront-perf-traversal']:
            cmd += ['-v', 'size=100000']
        if sql.name == 'cleanup-functions.sql':
            cmd = [
                'docker',
                'exec',
                '-i',
                'supabase_db_sellf-rcgate',
                'sh',
                '-c',
                'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1',
            ]
        if sql.name == 'webhook-secret-rotation.sql':
            script = 'BEGIN;\n' + script + '\nROLLBACK;\n'
        if sql.name == 'product-vat-rate-repair.sql':
            script = script.replace(
                '\\ir :repair', read_migration_source('20261017173304_product_vat_rate_units_repair.sql')
            )
        run('sql-' + sql.stem, cmd, stdin=script)
    run('restore-seed', ['python3', '-B', str(ROOT / 'supabase/tests/local_stack.py'), 'reset', str(STACK)])
    run('restore-kong', ['python3', '-B', str(ROOT / 'supabase/tests/local_stack.py'), 'ready', str(STACK)])
    for kind in ['postgrest', 'concurrency']:
        run('affiliates-' + kind, ['python3', str(ROOT / f'supabase/tests/affiliates-phase1-{kind}.py')])
    for suite in ['admin', 'first-run', 'payouts', 'payouts/mode', 'portal', 'products', 'restore', 'sync']:
        run_vitest(
            'affiliate-db-' + suite.replace('/', '-'),
            ['bun', 'x', 'vitest', 'run', f'tests/affiliates/{suite}/database.test.ts'],
            {'AFFILIATE_TEST_ENV': str(OUT / 'affiliates.env')},
        )
    run_vitest('invoicing-db', ['bun', 'x', 'vitest', 'run', '--config', 'vitest.invoicing.config.ts'])
    with (OUT / 'database.ts').open('w') as output:
        require(
            'types-generate', [CLI, 'gen', 'types', 'typescript', '--local', '--workdir', str(STACK)], stdout=output
        )
    run('types-diff', ['diff', '-u', str(ROOT / 'admin-panel/src/types/database.ts'), str(OUT / 'database.ts')])


def api():
    clean()
    # Forward reporter flags through the frozen candidate's API server driver.
    driver = """
bun() {
    if [[ $# == 2 && "$1" == run && "$2" == test:api ]]; then
        set -- "$@" --reporter=json "--outputFile=$RC_GATE_VITEST_REPORT"
    fi
    command bun "$@"
}
export -f bun
exec bash scripts/run-api-tests.sh
"""
    run(
        'api',
        ['bash', '-c', driver],
        ADMIN,
        {'TEST_API_LOG': str(OUT / 'api-server.log'), 'RC_GATE_VITEST_REPORT': str(vitest_report_path('api'))},
    )
    verify_vitest('api')


def reset(name, ready):
    helper = str(ROOT / 'supabase/tests/local_stack.py')
    require(name, ['python3', '-B', helper, 'reset', str(STACK)])
    require(ready, ['python3', '-B', helper, 'ready', str(STACK)])
