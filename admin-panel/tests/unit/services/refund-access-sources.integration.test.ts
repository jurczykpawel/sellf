/** Independent grants and order periods are reconciled through real committed purchases. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
    sql(`SELECT public.grant_product_and_bundle_components('${user}','${productId}',NULL,'${id}');`);
    return id;
  }
  function revoke(id: string, productId = product) {
    sql(`SELECT public.revoke_order_product_access('${id}','${user}','${productId}'); SELECT public.revoke_order_bundle_components('${id}','${user}');`);
  }
  function refund(id: string, productId = product) {
    sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${id}';`); revoke(id, productId);
  }
  return { user, product, bundle, access, buy, refund, revoke,
    cleanup() { sql(`DELETE FROM public.payment_transactions WHERE user_id='${user}'; DELETE FROM public.subscriptions WHERE user_id='${user}'; DELETE FROM auth.users WHERE id='${user}'; DELETE FROM public.bundle_items WHERE bundle_product_id='${bundle}'; DELETE FROM public.products WHERE id IN ('${product}','${bundle}');`); } };
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
