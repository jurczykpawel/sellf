"""Upgrade a disposable v2026.10.6 shop through the installed updater's HTTP RPC.

@see upgrade.sh; ../../supabase/tests/upgrade-fixture-2026-10-6.sql
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'sellf-upg'
CONTAINER = 'supabase_db_' + PROJECT
TABLES = ('products', 'payment_transactions', 'payment_line_items', 'guest_purchases',
          'user_product_access', 'coupons', 'coupon_redemptions', 'order_bumps', 'oto_offers',
          'bundle_items', 'variant_groups', 'product_variant_groups', 'webhook_endpoints',
          'webhook_logs', 'product_price_history', 'subscriptions', 'stripe_customers')


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def load_gate():
    while os.getloadavg()[0] > 28:
        print('Waiting for 1-minute system load <= 28', flush=True)
        time.sleep(20)


def sql(source):
    try:
        return run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres',
                    '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                   input=source, capture_output=True).stdout.strip()
    except subprocess.CalledProcessError as error:
        raise RuntimeError(error.stderr) from None


def totals():
    return {**{table: sql(f'SELECT count(*) FROM public.{table}') for table in TABLES},
            'amount': sql('SELECT coalesce(sum(amount),0) FROM public.payment_transactions'),
            'line_total': sql('SELECT coalesce(sum(total_price),0) FROM public.payment_line_items')}


def rpc(status, name, body):
    request = urllib.request.Request(status['API_URL'] + '/rest/v1/rpc/' + name,
                                    json.dumps(body).encode(), headers={
        'apikey': status['SERVICE_ROLE_KEY'],
        'Authorization': 'Bearer ' + status['SERVICE_ROLE_KEY'],
        'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        payload = json.load(error)
        raise RuntimeError(f"{name} {body.get('migration_version', '')}: HTTP {error.code}: {payload}") from None


def main():
    running = run(['docker', 'ps', '--format', '{{.Names}}'], capture_output=True).stdout.splitlines()
    if any(name.endswith('_' + PROJECT) for name in running):
        raise RuntimeError('sellf-upg already running; refusing to reuse or reset it')
    if sum(name.startswith('supabase_db_') for name in running) >= 2:
        raise RuntimeError('Two Supabase stacks already running')
    work = Path(tempfile.mkdtemp(prefix='sellf-upg-'))
    started = False
    try:
        # Extract the released tree, never rebuild the baseline from candidate files.
        archive = subprocess.Popen(['git', 'archive', 'v2026.10.6', 'supabase'], cwd=ROOT, stdout=subprocess.PIPE)
        run(['tar', '-x', '-C', str(work)], stdin=archive.stdout)
        archive.stdout.close()
        if archive.wait() != 0:
            raise RuntimeError('Cannot extract released tag')
        config_path = work / 'supabase/config.toml'
        config = re.sub(r'^project_id = .*$', 'project_id = "sellf-upg"', config_path.read_text(), flags=re.M)
        for i in range(10):
            config = config.replace(str(54320 + i), str(55570 + i))
        config = config.replace('enabled = true\nclient_id = "env(GITHUB_CLIENT_ID)"', 'enabled = false\nclient_id = "env(GITHUB_CLIENT_ID)"')
        config_path.write_text(config)
        load_gate()
        started = True
        with (work / 'start.log').open('w') as log:
            run(['npx', 'supabase', 'start', '--workdir', str(work)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        status = json.loads(run(['npx', 'supabase', 'status', '--workdir', str(work), '-o', 'json'], cwd=ROOT, capture_output=True).stdout)
        assert status['API_URL'] == 'http://127.0.0.1:55571'
        assert sql('SELECT rolsuper FROM pg_roles WHERE rolname=current_user') == 'f'
        assert sql("SELECT r.rolsuper FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.apply_migration(text,text,text)'::regprocedure") == 'f'
        sql((ROOT / 'supabase/tests/upgrade-fixture-2026-10-6.sql').read_text())
        before = totals()
        print('BASELINE', json.dumps(before, sort_keys=True), flush=True)
        applied = rpc(status, 'get_migration_status', {})
        versions = {row['version'].split('_')[0] for row in applied}
        migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        candidates = [p for p in migrations if p.name >= '20261016000000']
        assert candidates
        for migration in candidates:
            assert migration.stem.split('_')[0] not in versions, migration.name
            # Shell command substitution in upgrade.sh removes trailing newlines.
            source = migration.read_text().rstrip('\n')
            body = dict(migration_version=migration.stem, migration_sql=source,
                        content_checksum=hashlib.sha256(source.encode()).hexdigest())
            result = rpc(status, 'apply_migration', body)
            assert result.get('success') is True and result.get('skipped') is False, (migration.name, result)
            repeated = rpc(status, 'apply_migration', body)
            assert repeated.get('success') is True and repeated.get('skipped') is True, (migration.name, repeated)
            print('PASS RPC + repeat', migration.name, flush=True)
        after = totals()
        assert before == after, (before, after)
        print('PASS preserved row counts and financial totals', json.dumps(after, sort_keys=True), flush=True)
        print(sql('''DO $$ BEGIN
          ASSERT NOT EXISTS (SELECT 1 FROM public.payment_transactions WHERE payment_provider <> 'stripe' OR order_number IS NULL OR pricing_snapshot_version IS NOT NULL);
          ASSERT (SELECT count(*)=count(DISTINCT order_number) FROM public.payment_transactions);
          ASSERT NOT EXISTS (SELECT 1 FROM public.guest_purchases g JOIN public.payment_transactions t USING(session_id) WHERE g.transaction_id IS DISTINCT FROM t.id);
          ASSERT NOT EXISTS (SELECT 1 FROM public.products WHERE vat_rate > 0 AND vat_rate < 1);
          ASSERT NOT EXISTS (SELECT 1 FROM public.products WHERE checkout_profile IS NOT NULL);
          ASSERT (SELECT vat_rate=23 AND price_includes_vat FROM public.products WHERE slug='upgrade-subscription');
          ASSERT (SELECT vat_rate=23 AND NOT price_includes_vat FROM public.products WHERE slug='upgrade-net');
          ASSERT (SELECT sale_quantity_sold=2 AND sale_quantity_limit=10 AND sale_price=150 FROM public.products WHERE slug='upgrade-sale');
        END $$;'''), flush=True)
        # The same service-role completion RPC called by the Stripe webhook.
        completion = dict(session_id_param='cs_upgrade_7', product_id_param=sql("SELECT id FROM public.products WHERE slug='upgrade-gross'"),
                          customer_email_param='upgrade-member@example.com', amount_total=12300,
                          currency_param='PLN', stripe_payment_intent_id='pi_upgrade_pending',
                          user_id_param='a1100000-0000-4000-8000-000000000001')
        result = rpc(status, 'process_stripe_payment_completion_with_bump', completion)
        assert result.get('success') is True and result.get('pricing_source') == 'legacy', result
        sql('''DO $$ BEGIN
          ASSERT EXISTS (SELECT 1 FROM public.user_product_access WHERE user_id='a1100000-0000-4000-8000-000000000001' AND product_id=(SELECT id FROM public.products WHERE slug='upgrade-gross'));
          ASSERT (SELECT status='completed' AND pricing_snapshot_version IS NULL FROM public.payment_transactions WHERE session_id='cs_upgrade_7');
        END $$;''')
        print('PASS legacy pending completion + access', flush=True)
        environment = os.environ | {
            'SUPABASE_URL': status['API_URL'], 'NEXT_PUBLIC_SUPABASE_URL': status['API_URL'],
            'SUPABASE_SERVICE_ROLE_KEY': status['SERVICE_ROLE_KEY'],
            'SUPABASE_ANON_KEY': status['ANON_KEY'], 'NEXT_PUBLIC_SUPABASE_ANON_KEY': status['ANON_KEY'],
            'MAILPIT_URL': 'http://127.0.0.1:55574', 'PW_PORT': '55581',
            'PLAYWRIGHT_BASE_URL': 'http://localhost:55581',
            'SITE_URL': 'http://localhost:55581', 'NEXT_PUBLIC_SITE_URL': 'http://localhost:55581',
        }
        load_gate()
        run(['bunx', 'playwright', 'test', '--config=tests/upgrade-matrix/upgrade-data.config.ts'], cwd=ROOT / 'admin-panel', env=environment)
        print(f'PASS populated release upgrade: {len(candidates)} migrations, SQL assertions and browser smoke', flush=True)
    finally:
        if started:
            run(['npx', 'supabase', 'stop', '--no-backup', '--workdir', str(work)], cwd=ROOT)
        # Keep startup diagnostics with credential values removed.
        startup_log = work / 'start.log'
        if startup_log.exists():
            log = startup_log.read_text()
            log = re.sub(r'("[^"\n]*(?:KEY|SECRET)[^"\n]*": )"[^"\n]*"', r'\1"[redacted]"', log)
            startup_log.write_text(log)
        print('Upgrade diagnostics:', work, flush=True)
        shutil.rmtree(work / 'supabase', ignore_errors=True)


def terminate(_signum, _frame):
    raise SystemExit('Upgrade gate interrupted')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, terminate)
    main()
