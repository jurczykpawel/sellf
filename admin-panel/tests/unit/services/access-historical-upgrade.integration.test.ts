/** Released schema and pre-upgrade purchases, using the updater's batch builder. */
import { execFileSync } from 'node:child_process';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PINNED_SUPABASE_CLI, rewriteConfigForSnapshot } from '../../../scripts/schema-snapshot';

const root = path.resolve(__dirname, '../../../..');
const work = mkdtempSync(path.join(tmpdir(), 'sellf-historical-'));
const project = process.env.HISTORICAL_UPGRADE_PROJECT || `sellf-historical-${process.pid}`;
if (!/^sellf-(?:historical-\d+|w\d+-upgrade)$/.test(project)) throw new Error('Disposable upgrade project required');
const cli = process.env.SUPABASE_BIN || 'supabase';
const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };
const run = (cmd: string, args: string[], input?: string) => execFileSync(cmd, args, {
  input, encoding: 'utf8', env, cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
});
const sql = (body: string) => run('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-XqAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  `SET request.jwt.claims='{"role":"service_role"}'; ${body}`).trim().split('\n').at(-1)!;
const course = randomUUID(), bundle = randomUUID(), anchor = Date.now();
const day = (n: number) => new Date(anchor + n * 86400000).toISOString();
const unknown = ['bundle-refund', 'bundle-cancel', 'product-refund', 'product-cancel']
  .flatMap(action => [false, true].map(unlimited => ({ user: randomUUID(), action, unlimited })));
const transfers = ['payment', 'cancel', 'effective', 'later-purchase'].map(action => ({ user: randomUUID(), order: randomUUID(), action, later: randomUUID() }));
const grant = (user: string, product: string, order: string, placement = false) => sql(`BEGIN;
  SELECT set_config('sellf.transfer_order','${placement ? order : ''}',true);
  SELECT public.grant_product_and_bundle_components('${user}','${product}',NULL,'${order}'); COMMIT;`);
// The released signature has three arguments; its trigger decides whether placement changed access.
const oldGrant = (user: string, product: string, order = '') => sql(`BEGIN;
  SELECT set_config('sellf.transfer_order','${order}',true);
  SELECT public.grant_product_and_bundle_components('${user}','${product}'); COMMIT;`);
function order(user: string, product: string, status: string, id = randomUUID(), age = 0) {
  sql(`INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,amount,currency,status,payment_provider,pricing_snapshot_version,created_at,metadata)
    VALUES('${id}','${product}','${user}','${user}@example.com',4000,'PLN','${status}','bank_transfer',1,'${day(age)}','{"access_on_placement":true}');`);
  return id;
}
const access = (user: string) => JSON.parse(sql(`SELECT coalesce((SELECT row_to_json(a) FROM public.user_product_access a WHERE user_id='${user}' AND product_id='${course}'),'null'::json);`));
const days = (user: string) => (new Date(access(user).access_expires_at).getTime() - anchor) / 86400000;
let owned = false;
beforeAll(() => {
  expect(run(cli, ['--version']).trim()).toBe(PINNED_SUPABASE_CLI);
  expect(run('docker', ['ps', '-a', '--filter', `name=^supabase_db_${project}$`, '--format', '{{.Names}}']).trim()).toBe('');
  const archive = execFileSync('git', ['archive', 'v2026.11.0', 'supabase'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', work], { input: archive });
  const config = path.join(work, 'supabase/config.toml');
  writeFileSync(config, rewriteConfigForSnapshot(readFileSync(config, 'utf8'), project,
    process.env.HISTORICAL_UPGRADE_PORT_PREFIX || String(randomInt(610, 650))));
  rmSync(path.join(work, 'supabase/seed.sql'));
  owned = true;
  run(cli, ['start', '--workdir', work, '-x', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  expect(sql("SELECT count(*) FROM information_schema.columns WHERE table_name='user_product_access' AND column_name='independent_access';")).toBe('0');
  sql(`INSERT INTO public.products(id,name,slug,price,currency,auto_grant_duration_days,allow_repeat_purchase,is_bundle) VALUES
    ('${course}','Upgrade course','${course}',40,'PLN',365,true,false),('${bundle}','Upgrade bundle','${bundle}',60,'PLN',365,true,true);
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id) VALUES('${bundle}','${course}');
    ${[...unknown, ...transfers].map(f => `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${f.user}','${f.user}@example.com',now());`).join('')}`);
  for (const f of unknown) sql(`INSERT INTO public.user_product_access(user_id,product_id,grant_source,access_granted_at,access_expires_at)
    VALUES('${f.user}','${course}','unknown','${day(-200)}',${f.unlimited ? 'NULL' : `'${day(165)}'`});`);
  for (const f of transfers) {
    if (f.action === 'payment' || f.action === 'cancel') {
      order(f.user, course, 'completed', f.later, -50); oldGrant(f.user, course);
      sql(`UPDATE public.user_product_access SET access_granted_at='${day(-50)}',access_expires_at='${day(315)}' WHERE user_id='${f.user}';`);
    }
    order(f.user, course, 'awaiting_payment', f.order, -5);
    const before = access(f.user); oldGrant(f.user, course, f.order);
    if (before) expect(access(f.user)).toEqual(before);
    else sql(`UPDATE public.user_product_access SET access_granted_at='${day(-5)}',access_expires_at='${day(360)}' WHERE user_id='${f.user}';`);
    if (f.action === 'later-purchase') {
      order(f.user, course, 'completed', f.later, -2); oldGrant(f.user, course);
      sql(`UPDATE public.user_product_access SET access_granted_at='${day(-2)}' WHERE user_id='${f.user}';`);
    }
  }
  const updater = readFileSync(path.join(root, 'admin-panel/scripts/upgrade.sh'), 'utf8');
  const start = updater.indexOf('build_migration_batch() {'), end = updater.indexOf('\n}\n', start) + 3;
  const version = '20261118000000_release_2026_11_1', batch = path.join(work, 'batch.sql');
  run('bash', ['-s', '--', batch, version], `set -euo pipefail\nINSTALL_DIR="$PWD"\n${updater.slice(start, end)}\nlog() { echo "$@" >&2; }\nbuild_migration_batch "$1" "$2"\n`);
  const batchSql = readFileSync(batch, 'utf8');
  const checksum = createHash('sha256').update(batchSql).digest('hex');
  const source = batchSql.replaceAll("'", "''");
  const result = JSON.parse(sql(`SELECT public.apply_migration('${version}','${source}','${checksum}');`));
  expect(result.success).toBe(true); expect(result.skipped).toBe(false);
  expect(JSON.parse(sql(`SELECT public.apply_migration('${version}','${source}','${checksum}');`)).skipped).toBe(true);
}, 120000);

afterAll(() => {
  try { if (owned) run(cli, ['stop', '--project-id', project, '--no-backup', '--workdir', work]); }
  finally { rmSync(work, { recursive: true, force: true }); }
}, 60000);

it.each(unknown)('retains legacy unknown access across $action (unlimited=$unlimited) @J34', f => {
  const product = f.action.startsWith('bundle') ? bundle : course, cancel = f.action.endsWith('cancel');
  const id = order(f.user, product, cancel ? 'awaiting_payment' : 'completed');
  grant(f.user, product, id, cancel);
  sql(`UPDATE public.payment_transactions SET status='${cancel ? 'cancelled' : 'refunded'}',refunded_amount=${cancel ? 0 : 4000} WHERE id='${id}';`);
  if (!cancel) sql(`SELECT public.revoke_order_product_access('${id}','${f.user}','${product}'); SELECT public.revoke_order_bundle_components('${id}','${f.user}');`);
  expect(access(f.user)).not.toBeNull();
  if (f.unlimited) expect(access(f.user).access_expires_at).toBeNull();
  else expect(days(f.user)).toBeCloseTo(165, 6);
});
it.each(transfers)('settles an upgraded placement transfer: $action @J182', f => {
  if (f.action === 'payment') {
    expect(JSON.parse(sql(`SELECT public.complete_offline_order('${f.order}',4000);`)).success).toBe(true);
    expect(days(f.user)).toBeCloseTo(680, 3);
  } else if (f.action === 'cancel') {
    sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${f.order}';`);
    expect(days(f.user)).toBeCloseTo(315, 3);
  } else if (f.action === 'effective') {
    const paid = order(f.user, course, 'completed'); grant(f.user, course, paid);
    expect(days(f.user)).toBeCloseTo(725, 3);
    sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${f.order}';`);
    expect(days(f.user)).toBeCloseTo(365, 3);
  } else {
    expect(access(f.user).transfer_transaction_id).toBeNull();
    sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${f.later}';
      SELECT public.revoke_order_product_access('${f.later}','${f.user}','${course}');`);
    expect(days(f.user)).toBeCloseTo(725, 3);
  }
});
