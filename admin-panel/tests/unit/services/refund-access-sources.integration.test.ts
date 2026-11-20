/** Independent grants and order periods are reconciled through real committed purchases. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import created from '../../fixtures/stripe/charge_dispute_created_needs_response.json';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

function sql(body: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-XAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: `SET request.jwt.claims='{"role":"service_role"}'; ${body}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').at(-1)!;
}
const migration = readFileSync(new URL('../../../../supabase/migrations/20261118000000_release_2026_11_1.sql', import.meta.url), 'utf8');

// Replay upgrade data changes on private copies; shared fixtures are never backfilled.
function backfill(user: string) {
  const schema = `upgrade_${randomUUID().replaceAll('-', '')}`;
  const tables = ['user_product_access', 'payment_transactions', 'guest_purchases', 'payment_line_items', 'order_bundle_components', 'bundle_items'];
  const block = migration.match(/-- Preserve known legacy periods\.([\s\S]*?)-- End legacy period preservation\./)![1];
  sql(`BEGIN; CREATE SCHEMA ${schema}; ${tables.map(table => `CREATE TABLE ${schema}.${table} (LIKE public.${table}); INSERT INTO ${schema}.${table} SELECT * FROM public.${table};`).join('')}
    ALTER TABLE ${schema}.user_product_access DROP COLUMN independent_access;
    ALTER TABLE ${schema}.user_product_access ADD COLUMN independent_access jsonb;
    ${block.replaceAll('public.', `${schema}.`)}
    UPDATE public.user_product_access a SET independent_access=b.independent_access FROM ${schema}.user_product_access b WHERE a.id=b.id AND a.user_id='${user}';
    UPDATE public.payment_transactions t SET access_terms=b.access_terms FROM ${schema}.payment_transactions b WHERE t.id=b.id
      AND (t.user_id='${user}' OR EXISTS (SELECT 1 FROM public.guest_purchases g WHERE g.transaction_id=t.id AND g.claimed_by_user_id='${user}'));
    DROP SCHEMA ${schema} CASCADE; COMMIT;`);
}
function fixture(product = randomUUID(), bundle = randomUUID()) {
  const user = randomUUID();
  sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${user}','${user}@example.com',now());
    INSERT INTO public.products(id,name,slug,price,currency,auto_grant_duration_days,allow_repeat_purchase,is_bundle)
    VALUES('${product}','Course','${product}',40,'PLN',30,true,false),('${bundle}','Bundle','${bundle}',60,'PLN',30,true,true);
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id) VALUES('${bundle}','${product}');`);
  const access = () => JSON.parse(sql(`SELECT coalesce((SELECT row_to_json(a) FROM public.user_product_access a WHERE user_id='${user}' AND product_id='${product}'),'null'::json);`));
  function buy(productId = product, provider = 'stripe', status = 'completed', subscriptionId?: string) {
    const id = randomUUID();
    sql(`INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,amount,currency,status,payment_provider,session_id,metadata,subscription_id,pricing_snapshot_version)
      VALUES('${id}','${productId}','${user}','${user}@example.com',4000,'PLN','${status}','${provider}',${provider === 'stripe' ? `'cs_${id.replaceAll('-', '')}'` : 'NULL'},'{"access_on_placement":true}',${subscriptionId ? `'${subscriptionId}'` : 'NULL'},1);`);
    sql(`BEGIN; SELECT set_config('sellf.transfer_order','${status === 'awaiting_payment' ? id : ''}',true); SELECT public.grant_product_and_bundle_components('${user}','${productId}',NULL,'${id}'); COMMIT;`);
    return id;
  }
  function revoke(id: string, productId = product) {
    sql(`SELECT public.revoke_order_product_access('${id}','${user}','${productId}'); SELECT public.revoke_order_bundle_components('${id}','${user}');`);
  }
  function refund(id: string, productId = product) {
    sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${id}';`); revoke(id, productId);
  }
  return { user, product, bundle, access, buy, refund, revoke,
    cleanup() { sql(`DELETE FROM public.payment_transactions WHERE product_id IN ('${product}','${bundle}'); DELETE FROM public.subscriptions WHERE user_id='${user}'; DELETE FROM auth.users WHERE id='${user}'; DELETE FROM public.bundle_items WHERE bundle_product_id='${bundle}'; DELETE FROM public.products WHERE id IN ('${product}','${bundle}');`); } };
}

function paidBundleAddon(f: ReturnType<typeof fixture>) {
  const main = randomUUID();
  sql(`INSERT INTO public.products(id,name,slug,price,currency,auto_grant_duration_days,allow_repeat_purchase) VALUES('${main}','Main','${main}',40,'PLN',30,true);`);
  const order = f.buy(main);
  sql(`UPDATE public.payment_transactions SET amount=10000 WHERE id='${order}';
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency) VALUES
      ('${order}','${main}','main_product',40,40,'PLN'),('${order}','${f.bundle}','order_bump',60,60,'PLN');
    SELECT public.grant_product_and_bundle_components('${f.user}','${f.bundle}',NULL,'${order}');`);
  return { order, main, cleanup() { sql(`DELETE FROM public.payment_transactions WHERE product_id='${main}'; DELETE FROM public.products WHERE id='${main}';`); } };
}

it.each(['stripe', 'bank_transfer', 'free'])('restores the original %s component deadline after a later bundle refund @J34', source => {
  const f = fixture();
  try {
    if (source === 'free') sql(`UPDATE public.products SET price=0 WHERE id='${f.product}'; SET request.jwt.claim.sub='${f.user}'; SELECT public.grant_free_product_access('${f.product}',30);`);
    else f.buy(f.product, source);
    const original = f.access();
    expect(original).not.toBeNull();
    const bundleOrder = f.buy(f.bundle);
    expect(new Date(f.access().access_expires_at).getTime()).toBeGreaterThan(new Date(original.access_expires_at).getTime() + 29 * 86400000);
    f.refund(bundleOrder, f.bundle);
    expect(f.access()?.access_expires_at).toBe(original.access_expires_at);
  } finally { f.cleanup(); }
});

function manual(f: ReturnType<typeof fixture>, expires: string | null, action = 'update', productId = f.product) {
  sql(`SELECT * FROM public.mutate_access('${action}','${f.user}','${productId}',${action === 'grant' ? 'NULL' : `(SELECT id FROM public.user_product_access WHERE user_id='${f.user}' AND product_id='${productId}')`},
    jsonb_build_object('access_expires_at',${expires ? `'${expires}'::timestamptz` : 'NULL'}),'${JSON.stringify({ type: 'api_key', id: randomUUID() })}');`);
}
it.each([false,true])('preserves an administrator deadline including unlimited=%s across repeated refunds @J34', unlimited => {
  const f = fixture();
  try {
    f.buy(); const b = f.buy();
    manual(f, unlimited ? null : '2027-06-01T12:00:00Z');
    const expected = f.access().access_expires_at;
    f.refund(b); expect(f.access()?.access_expires_at).toBe(expected);
    manual(f, unlimited ? '2027-09-01T12:00:00Z' : null);
    const later = f.access().access_expires_at;
    f.revoke(b); f.refund(b);
    expect(f.access()?.access_expires_at).toBe(later);
  } finally { f.cleanup(); }
});
it.each([false,true])('retains manual access while removing a later purchased extension (bundle=%s) @J34', bundle => {
  const f = fixture();
  try {
    manual(f, '2027-02-01T12:00:00Z','grant'); const original = f.access();
    const id = f.buy(bundle ? f.bundle : f.product);
    expect(new Date(f.access().access_expires_at).getTime()).toBeGreaterThan(new Date(original.access_expires_at).getTime());
    f.refund(id,bundle ? f.bundle : f.product);
    expect(f.access()?.access_expires_at).toBe(original.access_expires_at);
  } finally { f.cleanup(); }
});

it.each([false,true])('preserves the known legacy period after reducing the product duration (bundle=%s) @J34', bundle => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=90 WHERE id='${f.product}';`);
    const a = f.buy(bundle ? f.bundle : f.product); const original = f.access();
    sql(`UPDATE public.payment_transactions SET access_terms='{}' WHERE id='${a}'; UPDATE public.products SET auto_grant_duration_days=7 WHERE id='${f.product}';`);
    backfill(f.user);
    const b = f.buy(); f.refund(b);
    expect(f.access()?.access_expires_at).toBe(original.access_expires_at);
  } finally { f.cleanup(); }
});

it.each([false,true])('releases the unpaid placement period after a later purchase (guest=%s) @J182', guest => {
  const f = fixture();
  try {
    const a = f.buy(f.product,'bank_transfer','awaiting_payment');
    expect(f.access().transfer_transaction_id).toBe(a);
    if (guest) sql(`UPDATE public.payment_transactions SET user_id=NULL WHERE id='${a}';
      INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_id,transaction_amount,claimed_by_user_id,claimed_at)
      VALUES('${f.product}','${f.user}@example.com',NULL,'${a}',4000,'${f.user}',now());`);
    const b = f.buy(); expect(f.access().transfer_transaction_id).toBeNull();
    const terms = JSON.parse(sql(`SELECT access_terms->'${f.user}:${f.product}' FROM public.payment_transactions WHERE id='${b}';`));
    sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${a}';`);
    expect(new Date(f.access().access_expires_at).getTime()).toBe(new Date(terms.expiresAt).getTime());
  } finally { f.cleanup(); }
});

it.each(['before','after','manual','none'])('keeps the independent %s source when a subscription invoice is refunded @J34', source => {
  const f = fixture(), sub = randomUUID();
  try {
    if (source === 'before') f.buy();
    sql(`INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,status,current_period_end)
      VALUES('${sub}','${f.user}','${f.product}','cus_${sub}','sub_${sub}','active',now()+interval '30 days');`);
    const invoice = f.buy(f.product,'stripe','completed',sub);
    sql(`UPDATE public.user_product_access SET subscription_id='${sub}',access_expires_at=NULL WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    if (source === 'after') f.buy();
    if (source === 'manual') manual(f,'2027-06-01T12:00:00Z');
    const expected = source === 'manual' ? f.access().access_expires_at : sql(`SELECT term->>'expiresAt' FROM public.payment_transactions t, jsonb_each(t.access_terms) e(key,term) WHERE user_id='${f.user}' AND subscription_id IS NULL LIMIT 1;`);
    sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${invoice}';`);
    if (source === 'none') expect(f.access()).toBeNull();
    else {
      expect(new Date(f.access()?.access_expires_at).getTime()).toBe(new Date(expected).getTime());
      expect(f.access()?.subscription_id).toBeNull();
    }
  } finally { f.cleanup(); }
});

it.each(['apply', 'revoke'])('waits for the dispute snapshot before %s @J34', async operation => {
  const f = fixture(), dispute = `dp_${randomUUID().replaceAll('-', '')}`;
  const holder = spawn('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1']);
  const ended = once(holder,'exit');
  try {
    const order = f.buy(), d = created.data.object;
    const apply = `SELECT public.apply_payment_dispute('${order}','${dispute}','${d.status}',false,'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created}));`;
    sql(apply);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Dispute lock was not acquired')),5000);
      holder.stdout.on('data', chunk => { if (String(chunk).includes('held')) { clearTimeout(timer); resolve(); } });
      holder.once('error', error => { clearTimeout(timer); reject(error); });
      holder.stdin.write(`BEGIN; UPDATE public.payment_disputes SET account_access=account_access WHERE stripe_dispute_id='${dispute}'; SELECT 'held';\n`);
    });
    const command = operation === 'apply' ? apply : `SELECT public.revoke_order_product_access('${order}','${f.user}','${f.product}');`;
    expect(() => sql(`SET lock_timeout='200ms'; ${command}`)).toThrow(/lock timeout/);
  } finally {
    holder.stdin.end('ROLLBACK;\n'); await ended; f.cleanup();
  }
});

it.each(['purchase','transfer','guest-transfer'])('respects transfer ownership and conservative legacy periods for %s during upgrade @J34', source => {
  const f = fixture();
  try {
    const old = f.buy();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '100 days',paid_at=now()-interval '100 days',access_terms='{}' WHERE id='${old}';
      UPDATE public.user_product_access SET access_granted_at=now()-interval '100 days',access_expires_at=now()-interval '70 days' WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    const later = f.buy(f.product,source === 'purchase' ? 'stripe' : 'bank_transfer',source === 'purchase' ? 'completed' : 'awaiting_payment');
    sql(`UPDATE public.payment_transactions SET access_terms='{}' WHERE id='${later}';`);
    if (source === 'guest-transfer') sql(`UPDATE public.payment_transactions SET user_id=NULL WHERE id='${later}';
      INSERT INTO public.guest_purchases(product_id,customer_email,transaction_id,transaction_amount,claimed_by_user_id,claimed_at)
      VALUES('${f.product}','${f.user}@example.com','${later}',4000,'${f.user}',now());`);
    const known = f.access();
    backfill(f.user);
    if (source === 'purchase') f.refund(later);
    else sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${later}';`);
    if (source === 'purchase') expect(f.access()?.access_expires_at).toBe(known.access_expires_at);
    else expect(f.access()).toBeNull();
  } finally { f.cleanup(); }
});

it('publishes one final access change when retaining a purchase after a subscription refund @J34', () => {
  const f = fixture(), sub = randomUUID();
  try {
    f.buy();
    sql(`INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,status,current_period_end)
      VALUES('${sub}','${f.user}','${f.product}','cus_${sub}','sub_${sub}','active',now()+interval '30 days');`);
    const invoice = f.buy(f.product,'stripe','completed',sub);
    sql(`UPDATE public.user_product_access SET subscription_id='${sub}',access_expires_at=NULL WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    const count = () => Number(sql(`SELECT count(*) FROM public.business_events WHERE product_id='${f.product}' AND event_type='access.updated';`));
    const before = count();
    sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${invoice}';`);
    expect(count() - before).toBe(1);
    expect(f.access()?.subscription_id).toBeNull(); expect(f.access()?.access_expires_at).not.toBeNull();
  } finally { f.cleanup(); }
});

it('leaves pre-existing access unchanged when cancelling a transfer that granted no placement access @J182', () => {
  const f = fixture(), id = randomUUID();
  try {
    sql(`INSERT INTO public.user_product_access(user_id,product_id,access_expires_at) VALUES('${f.user}','${f.product}',now()+interval '30 days');`);
    const original = f.access();
    sql(`INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,amount,currency,status,payment_provider,pricing_snapshot_version)
      VALUES('${id}','${f.product}','${f.user}','${f.user}@example.com',4000,'PLN','awaiting_payment','bank_transfer',1);
      UPDATE public.payment_transactions SET status='cancelled' WHERE id='${id}';`);
    expect(f.access()).toEqual(original);
  } finally { f.cleanup(); }
});

it.each([365,null])('preserves legacy access originally lasting %s days after a historical default change @J34', duration => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=${duration ?? 'NULL'} WHERE id='${f.product}';`);
    const a = f.buy();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '100 days',paid_at=now()-interval '100 days',access_terms='{}' WHERE id='${a}';
      UPDATE public.user_product_access SET access_granted_at=now()-interval '100 days',access_expires_at=${duration ? "now()+interval '265 days'" : 'NULL'} WHERE user_id='${f.user}' AND product_id='${f.product}';
      UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${f.product}';`);
    const b = f.buy();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '50 days',paid_at=now()-interval '50 days',access_terms='{}' WHERE id='${b}';
      UPDATE public.user_product_access SET access_granted_at=now()-interval '50 days' WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    const known = f.access();
    backfill(f.user);
    f.refund(b);
    expect(f.access()).not.toBeNull();
    expect(f.access().access_expires_at).toBe(known.access_expires_at);
  } finally { f.cleanup(); }
});

it.each(['bundle-refund', 'bundle-cancel', 'product-cancel', 'product-refund'].flatMap(scenario => [165, null].map(days => [scenario, days] as const)))('retains a pre-upgrade unknown deadline after %s (days=%s) @J34', (scenario, days) => {
  const f = fixture();
  try {
    sql(`INSERT INTO public.user_product_access(user_id,product_id,grant_source,access_granted_at,access_expires_at)
      VALUES('${f.user}','${f.product}','unknown',now()-interval '200 days',${days === null ? 'NULL' : `now()+interval '${days} days'`});`);
    const original = f.access();
    expect(original.independent_access).toBeNull();
    backfill(f.user);
    const isBundle = scenario.startsWith('bundle'), cancel = scenario.endsWith('cancel');
    const order = f.buy(isBundle ? f.bundle : f.product, cancel ? 'bank_transfer' : 'stripe', cancel ? 'awaiting_payment' : 'completed');
    if (cancel) sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${order}';`);
    else f.refund(order, isBundle ? f.bundle : f.product);
    expect(f.access()?.access_expires_at).toBe(original.access_expires_at);
  } finally { f.cleanup(); }
});

it('does not reconcile a placement transfer that left the access row untouched @J182', () => {
  const f = fixture();
  try {
    sql(`INSERT INTO public.user_product_access(user_id,product_id,access_expires_at) VALUES('${f.user}','${f.product}',now()+interval '200 days');`);
    const original = f.access();
    const order = f.buy(f.bundle,'bank_transfer','awaiting_payment');
    sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${order}';`);
    expect(f.access()).toEqual(original);
  } finally { f.cleanup(); }
});

it.each(['terms', 'payment'])('records only effective placement grants before later transfer %s @J182', check => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=365 WHERE id='${f.product}';`);
    const paid = f.buy();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '105 days',paid_at=now()-interval '105 days',
      access_terms=jsonb_build_object('${f.user}:${f.product}',jsonb_build_object('grantedAt',now()-interval '105 days','expiresAt',now()+interval '260 days')) WHERE id='${paid}';
      UPDATE public.user_product_access SET access_granted_at=now()-interval '105 days',access_expires_at=now()+interval '260 days' WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    const transfer = f.buy(f.product,'bank_transfer','awaiting_payment');
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '5 days' WHERE id='${transfer}';`);
    if (check === 'terms') expect(sql(`SELECT access_terms::text FROM public.payment_transactions WHERE id='${transfer}';`)).toBe('{}');
    else {
      f.refund(paid);
      expect(JSON.parse(sql(`SELECT public.complete_offline_order('${transfer}',4000);`)).success).toBe(true);
      const remaining = Number(sql(`SELECT extract(epoch FROM (access_expires_at-now()))/86400 FROM public.user_product_access WHERE user_id='${f.user}' AND product_id='${f.product}';`));
      expect(remaining).toBeCloseTo(365, 3);
    }
  } finally { f.cleanup(); }
});

it.each(['bump', 'bundle-component', 'twice'])('retains only days added by an order-independent %s after refund @J34', path => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=365 WHERE id='${f.product}';`);
    const paid = f.buy();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '100 days',paid_at=now()-interval '100 days',
      access_terms=jsonb_build_object('${f.user}:${f.product}',jsonb_build_object('grantedAt',now()-interval '100 days','expiresAt',now()+interval '265 days')) WHERE id='${paid}';
      UPDATE public.user_product_access SET access_granted_at=now()-interval '100 days',access_expires_at=now()+interval '265 days' WHERE user_id='${f.user}' AND product_id='${f.product}';
      UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${f.product}';`);
    const count = path === 'twice' ? 2 : 1;
    for (let i=0;i<count;i++) sql(path === 'bundle-component'
      ? `SELECT public.grant_product_and_bundle_components('${f.user}','${f.bundle}');`
      : `SELECT public.grant_product_and_bundle_components('${f.user}','${f.product}');`);
    f.refund(paid);
    const days = Number(sql(`SELECT extract(epoch FROM (access_expires_at-now()))/86400 FROM public.user_product_access WHERE user_id='${f.user}' AND product_id='${f.product}';`));
    expect(days).toBeCloseTo(30*count,3);
    const retained = f.access().access_expires_at;
    f.revoke(paid);
    expect(f.access()?.access_expires_at).toBe(retained);
  } finally { f.cleanup(); }
});

it.each(['revoke_order_bundle_components', 'release_transfer_access'])('orders the product lock loop in %s @J34', fn => {
  const definition = sql(`SELECT replace(pg_get_functiondef(('public.${fn}()')::regprocedure),E'\\n',' ');`.replace('revoke_order_bundle_components()', 'revoke_order_bundle_components(uuid,uuid)'));
  if (fn === 'revoke_order_bundle_components') expect(definition).toMatch(/ORDER BY a\.product_id\s+LOOP/);
  else {
    expect(definition).toMatch(/ORDER BY 1\s+LOOP/g);
    expect(definition.match(/ORDER BY 1\s+LOOP/g)).toHaveLength(2);
  }
});

it('backfills legacy periods through equality joins @J34', () => {
  const block = migration.match(/-- Preserve known legacy periods\.([\s\S]*?)-- End legacy period preservation\./)![1];
  expect(block).not.toMatch(/EXISTS\s*\(|order_granted_components\(/);
  expect(block).toMatch(/a\.user_id = .*\.user_id/);
  expect(block).toMatch(/a\.product_id = .*\.product_id/);
});

it('keeps another buyer fixture byte-identical while backfilling an upgrade @J34', () => {
  const f = fixture(), other = fixture();
  try {
    sql(`INSERT INTO public.user_product_access(user_id,product_id,grant_source,access_expires_at) VALUES('${f.user}','${f.product}','unknown',now()+interval '100 days');`);
    const order = other.buy();
    sql(`UPDATE public.payment_transactions SET access_terms='{}' WHERE id='${order}';`);
    const beforeAccess = other.access();
    const beforeOrder = sql(`SELECT row_to_json(t)::text FROM public.payment_transactions t WHERE id='${order}';`);
    backfill(f.user);
    expect(other.access()).toEqual(beforeAccess);
    expect(sql(`SELECT row_to_json(t)::text FROM public.payment_transactions t WHERE id='${order}';`)).toBe(beforeOrder);
  } finally { f.cleanup(); other.cleanup(); }
});

it('adds no independent days when a free claim leaves paid access unchanged @J34', () => {
  const f = fixture();
  try {
    const order = f.buy(), before = f.access();
    sql(`UPDATE public.products SET price=0 WHERE id='${f.product}'; SET request.jwt.claim.sub='${f.user}'; SELECT public.grant_free_product_access('${f.product}',30);`);
    expect(f.access()).toEqual(before);
    f.refund(order);
    expect(f.access()).toBeNull();
  } finally { f.cleanup(); }
});

it('adds no free period to an already permanent paid entitlement @J34', () => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=NULL WHERE id='${f.product}';`);
    const order = f.buy();
    sql(`UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${f.product}'; SELECT public.grant_product_and_bundle_components('${f.user}','${f.product}');`);
    expect(f.access().independent_access).toBeNull();
    f.refund(order);
    expect(f.access()).toBeNull();
  } finally { f.cleanup(); }
});

it('preserves an effective legacy placement transfer after a later purchase cleared its link @J34', () => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=365 WHERE id='${f.product}';`);
    const transfer = f.buy(f.product,'bank_transfer','awaiting_payment');
    const paid = f.buy();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '100 days',access_terms='{}' WHERE id='${transfer}';
      UPDATE public.payment_transactions SET created_at=now()-interval '90 days',paid_at=now()-interval '90 days',access_terms='{}' WHERE id='${paid}';`);
    expect(f.access().transfer_transaction_id).toBeNull();
    const original = f.access().access_expires_at;
    backfill(f.user);
    f.refund(paid);
    expect(f.access()?.access_expires_at).toBe(original);
  } finally { f.cleanup(); }
});

it.each(['subscription', 'transfer'])('does not turn a legacy unknown row owned by a %s into an independent grant @J34', owner => {
  const f = fixture(), sub = randomUUID();
  try {
    sql(`INSERT INTO public.user_product_access(user_id,product_id,grant_source,access_granted_at,access_expires_at)
      VALUES('${f.user}','${f.product}','unknown',now()-interval '200 days',now()-interval '100 days');`);
    if (owner === 'subscription') sql(`INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,status,current_period_end)
      VALUES('${sub}','${f.user}','${f.product}','cus_${sub}','sub_${sub}','active',now()+interval '30 days');`);
    const order = f.buy(f.product, owner === 'subscription' ? 'stripe' : 'bank_transfer',owner === 'subscription' ? 'completed' : 'awaiting_payment',owner === 'subscription' ? sub : undefined);
    if (owner === 'subscription') sql(`UPDATE public.user_product_access SET subscription_id='${sub}',access_expires_at=NULL WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    expect(f.access().grant_source).toBe('unknown');
    backfill(f.user);
    if (owner === 'subscription') f.refund(order);
    else sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${order}';`);
    expect(f.access()).toBeNull();
  } finally { f.cleanup(); }
});

it('preserves the paid period after reopening a cancelled transfer and refunding a later purchase @J182', () => {
  const f = fixture();
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=365 WHERE id='${f.product}';`);
    const transfer = f.buy(f.product,'bank_transfer','awaiting_payment');
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '100 days',access_terms=jsonb_build_object('${f.user}:${f.product}',jsonb_build_object('grantedAt',now()-interval '100 days','expiresAt',now()+interval '265 days')) WHERE id='${transfer}';
      UPDATE public.user_product_access SET access_expires_at=now()+interval '265 days' WHERE user_id='${f.user}' AND product_id='${f.product}';
      SELECT public.cancel_unpaid_order('${transfer}','Fixture cancellation');`);
    const result = JSON.parse(sql(`SELECT public.admin_bank_transfer_order('${transfer}','mark-paid',4000,now(),'Late payment accepted',(SELECT user_id FROM public.admin_users LIMIT 1),true,false);`));
    expect(result.success).toBe(true);
    const paidDeadline = f.access().access_expires_at;
    const later = f.buy(); f.refund(later);
    expect(f.access()?.access_expires_at).toBe(paidDeadline);
  } finally { f.cleanup(); }
});

it.each(['payment', 'cancel', 'refund', 'refund-independent', 'refund-expired'])('tracks the actual bundle-add-on component period through transfer %s @J182', action => {
  const [component, bundle] = [randomUUID(), randomUUID()].sort();
  const f = fixture(component, bundle), main = randomUUID();
  const config = JSON.parse(sql("SELECT json_build_object('enabled',bank_transfer_enabled,'placement',bank_transfer_grant_access_on_placement) FROM public.bank_transfer_config;"));
  let order: string | undefined;
  try {
    sql(`UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_transfer_grant_access_on_placement=true;
      INSERT INTO public.products(id,name,slug,price,currency,auto_grant_duration_days,checkout_profile) VALUES('${main}','Main','${main}',40,'PLN',30,'{"v":1,"modules":[{"id":"buyer","types":["organization"],"bank_transfer_for":["organization"]}]}');
      INSERT INTO public.order_bumps(main_product_id,bump_product_id,bump_title) VALUES('${main}','${f.bundle}','Bundle extra');`);
    if (action === 'refund-expired') sql(`INSERT INTO public.user_product_access(user_id,product_id,grant_source,access_granted_at,access_expires_at) VALUES('${f.user}','${f.bundle}','manual',now()-interval '200 days',now()-interval '100 days');`);
    const placed = JSON.parse(sql(`SELECT public.bank_transfer_order(jsonb_build_object('product_id','${main}','currency','PLN','customer_email','${f.user}@example.com','order_details','{"v":1,"buyer":{"type":"organization","terms_accepted":true}}'::jsonb),
      jsonb_build_array(jsonb_build_object('product_id','${main}','item_type','main_product','quantity',1,'unit_price',40,'total_price',40,'discounted_total',40,'currency','PLN'),
        jsonb_build_object('product_id','${f.bundle}','item_type','order_bump','order_bump_id',(SELECT id FROM public.order_bumps WHERE main_product_id='${main}'),'quantity',1,'unit_price',60,'total_price',60,'discounted_total',60,'currency','PLN')));`));
    order = placed.transaction_id;
    expect(order).toBeTruthy();
    expect(f.access()).not.toBeNull();
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '5 days' WHERE id='${order}';
      UPDATE public.user_product_access SET access_expires_at=now()+interval '25 days' WHERE user_id='${f.user}' AND product_id='${f.product}';`);
    const original = f.access().access_expires_at;
    if (action === 'refund-independent') manual(f, new Date(Date.now()+50*86400000).toISOString(),'update',f.bundle);
    expect(sql(`SELECT access_terms ? '${f.user}:${f.product}' FROM public.payment_transactions WHERE id='${order}';`)).toBe('t');
    if (action !== 'cancel') {
      expect(JSON.parse(sql(`SELECT public.complete_offline_order('${order}',10000);`)).success).toBe(true);
      expect(f.access()?.access_expires_at).toBe(original);
    }
    if (action === 'cancel') sql(`SELECT public.cancel_unpaid_order('${order}','Fixture cancellation');`);
    if (action.startsWith('refund')) sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${order}';`);
    if (action === 'refund-independent') expect(f.access()?.access_expires_at).toBe(original);
    else if (action !== 'payment') expect(f.access()).toBeNull();
  } finally {
    sql(`DELETE FROM public.payment_transactions WHERE product_id='${main}'; DELETE FROM public.products WHERE id='${main}'; UPDATE public.bank_transfer_config SET bank_transfer_enabled=${config.enabled},bank_transfer_grant_access_on_placement=${config.placement};`);
    f.cleanup();
  }
});

it.each([false,true])('retains the original free component deadline after a later bundle grant (manual=%s) @J34', shorten => {
  const [component,bundle] = [randomUUID(),randomUUID()].sort(), f=fixture(component,bundle);
  let paid: ReturnType<typeof paidBundleAddon> | undefined;
  const age=shorten ? 25 : 10;
  let manualDeadline: string | undefined;
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=60 WHERE id='${f.bundle}'; SELECT public.grant_product_and_bundle_components('${f.user}','${f.bundle}');
      UPDATE public.user_product_access SET access_granted_at=now()-make_interval(days=>${age}),
        access_expires_at=now()+CASE WHEN product_id='${f.product}' THEN make_interval(days=>30-${age}) ELSE make_interval(days=>60-${age}) END,
        independent_access=jsonb_set(jsonb_set(independent_access,'{expiresAt}',to_jsonb(now()+CASE WHEN product_id='${f.product}' THEN make_interval(days=>30-${age}) ELSE make_interval(days=>60-${age}) END)), '{grantedAt}',to_jsonb(now()-make_interval(days=>${age})),false)
      WHERE user_id='${f.user}';`);
    const original=f.access().access_expires_at;
    paid=paidBundleAddon(f);
    if (shorten) {
      manual(f,new Date(Date.now()+40*86400000).toISOString(),'update',f.bundle);
      manualDeadline=sql(`SELECT access_expires_at FROM public.user_product_access WHERE user_id='${f.user}' AND product_id='${f.bundle}';`);
    }
    f.refund(paid.order,paid.main);
    expect(f.access()?.access_expires_at).toBe(original);
    if (shorten) expect(sql(`SELECT access_expires_at FROM public.user_product_access WHERE user_id='${f.user}' AND product_id='${f.bundle}';`)).toBe(manualDeadline);
  } finally { paid?.cleanup(); f.cleanup(); }
});

it('preserves the known legacy add-on component period after a later add-on refund @J34', () => {
  const [component,bundle] = [randomUUID(),randomUUID()].sort(), f=fixture(component,bundle);
  let old: ReturnType<typeof paidBundleAddon> | undefined, later: ReturnType<typeof paidBundleAddon> | undefined;
  try {
    sql(`UPDATE public.products SET auto_grant_duration_days=90 WHERE id='${f.product}'; UPDATE public.products SET auto_grant_duration_days=120 WHERE id='${f.bundle}';`);
    old=paidBundleAddon(f);
    sql(`UPDATE public.payment_transactions SET created_at=now()-interval '10 days',paid_at=now()-interval '10 days',access_terms='{}' WHERE id='${old.order}';
      UPDATE public.user_product_access SET access_granted_at=now()-interval '10 days', access_expires_at=now()+CASE WHEN product_id='${f.product}' THEN interval '80 days' WHEN product_id='${f.bundle}' THEN interval '110 days' ELSE interval '20 days' END WHERE user_id='${f.user}';`);
    const original=f.access().access_expires_at;
    backfill(f.user);
    sql(`UPDATE public.products SET auto_grant_duration_days=7 WHERE id='${f.product}'; UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${f.bundle}';`);
    later=paidBundleAddon(f); f.refund(later.order,later.main);
    expect(f.access()?.access_expires_at).toBe(original);
  } finally { later?.cleanup(); old?.cleanup(); f.cleanup(); }
});


it('claims a guest placement transfer once after account confirmation deferred its claim @J182', async () => {
  const f = fixture(), guest = randomUUID();
  const config = JSON.parse(sql('SELECT row_to_json(c) FROM public.bank_transfer_config c;'));
  const holder = spawn('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1']);
  const ended = once(holder, 'exit');
  try {
    sql(`UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_transfer_grant_access_on_placement=true;
      UPDATE public.products SET checkout_profile='{"v":1,"modules":[{"id":"buyer","types":["organization"],"bank_transfer_for":["organization"]}]}' WHERE id='${f.product}';`);
    const placed = JSON.parse(sql(`SELECT public.bank_transfer_order(jsonb_build_object('product_id','${f.product}','currency','PLN','customer_email','${guest}@example.com',
      'order_details','{"v":1,"buyer":{"type":"organization","terms_accepted":true}}'::jsonb),
      jsonb_build_array(jsonb_build_object('product_id','${f.product}','item_type','main_product','quantity',1,'unit_price',40,'total_price',40,'discounted_total',40,'currency','PLN')));`));
    expect(placed.transaction_id).toBeTruthy();
    sql(`INSERT INTO auth.users(id,email) VALUES('${guest}','${guest}@example.com');`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Guest lock was not acquired')),5000);
      holder.stdout.on('data', chunk => { if (String(chunk).includes('held')) { clearTimeout(timer); resolve(); } });
      holder.once('error', error => { clearTimeout(timer); reject(error); });
      holder.stdin.write(`BEGIN; SELECT id FROM public.guest_purchases WHERE transaction_id='${placed.transaction_id}' FOR UPDATE; SELECT 'held';\n`);
    });
    sql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id='${guest}';`);
    expect(sql(`SELECT count(*) FROM public.guest_purchases WHERE transaction_id='${placed.transaction_id}' AND claimed_by_user_id IS NULL;`)).toBe('1');
    expect(JSON.parse(sql(`SELECT public.complete_offline_order('${placed.transaction_id}',4000);`)).success).toBe(true);
    const deadline = sql(`SELECT access_expires_at FROM public.user_product_access WHERE user_id='${guest}' AND product_id='${f.product}';`);
    expect(new Date(deadline).getTime()).toBeGreaterThan(Date.now()+29*86400000);
    holder.stdin.end('COMMIT;\n'); await ended;
    expect(JSON.parse(sql(`SELECT public.claim_guest_purchases_for_user('${guest}');`)).claimed_count).toBe(1);
    expect(sql(`SELECT access_expires_at FROM public.user_product_access WHERE user_id='${guest}' AND product_id='${f.product}';`)).toBe(deadline);
    expect(JSON.parse(sql(`SELECT public.claim_guest_purchases_for_user('${guest}');`)).claimed_count).toBe(0);
  } finally {
    if (!holder.stdin.writableEnded) { holder.stdin.end('ROLLBACK;\n'); await ended; }
    sql(`DELETE FROM auth.users WHERE id='${guest}'; UPDATE public.bank_transfer_config SET bank_transfer_enabled=${config.bank_transfer_enabled},bank_transfer_grant_access_on_placement=${config.bank_transfer_grant_access_on_placement};`);
    f.cleanup();
  }
});
