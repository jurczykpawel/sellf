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
function fixture() {
  const user = randomUUID(), product = randomUUID(), bundle = randomUUID();
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

function manual(f: ReturnType<typeof fixture>, expires: string | null, action = 'update') {
  sql(`SELECT * FROM public.mutate_access('${action}','${f.user}','${f.product}',${action === 'grant' ? 'NULL' : `(SELECT id FROM public.user_product_access WHERE user_id='${f.user}' AND product_id='${f.product}')`},
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
    const migration = readFileSync(new URL('../../../../supabase/migrations/20261118000000_release_2026_11_1.sql', import.meta.url), 'utf8');
    sql(migration.match(/-- Preserve known legacy periods\.([\s\S]*?)-- End legacy period preservation\./)?.[1] || 'SELECT 1;');
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

it('reads a dispute again only after its refund snapshot update commits @J34', async () => {
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
    expect(() => sql(`SET lock_timeout='200ms'; ${apply}`)).toThrow(/lock timeout/);
  } finally {
    holder.stdin.end('ROLLBACK;\n'); await ended; f.cleanup();
  }
});

it.each(['purchase','transfer','guest-transfer'])('does not assign a later %s period to an expired legacy order during upgrade @J34', source => {
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
    const migration = readFileSync(new URL('../../../../supabase/migrations/20261118000000_release_2026_11_1.sql', import.meta.url),'utf8');
    sql(migration.match(/-- Preserve known legacy periods\.([\s\S]*?)-- End legacy period preservation\./)![1]);
    if (source === 'purchase') f.refund(later);
    else sql(`UPDATE public.payment_transactions SET status='cancelled' WHERE id='${later}';`);
    expect(f.access()).toBeNull();
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
