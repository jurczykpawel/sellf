/** Refunds retain only the current periods of the remaining sources. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
const buyer = 'e2970000-0000-4000-a000-000000000001';
const product = 'e2970000-0000-4000-a000-000000000002';
const a = 'e2970000-0000-4000-a000-000000000003';
const b = 'e2970000-0000-4000-a000-000000000004';
const parent = 'e2970000-0000-4000-a000-000000000005';
const assertion = (predicate: string) => `DO $test$ BEGIN IF (${predicate}) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Remaining access period differs'; END IF; END $test$;`;
const access = `SELECT * FROM public.user_product_access WHERE user_id='${buyer}' AND product_id='${product}'`;
function order(id: string, age = 0, productId = product, extra = "'{}'") {
  return `INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,amount,currency,status,created_at,metadata)
    VALUES('${id}','${productId}','${buyer}','periods@example.com','cs_${id.replaceAll('-', '')}',4000,'PLN','completed',now()-make_interval(days=>${age}),${extra});`;
}
const grant = (id: string, productId = product, override = 'NULL') => `SELECT public.grant_product_and_bundle_components('${buyer}','${productId}',${override},'${id}');`;
const refund = (id: string) => `UPDATE public.payment_transactions SET status='refunded',refunded_amount=4000 WHERE id='${id}';
  SELECT public.revoke_order_product_access('${id}','${buyer}','${product}');`;
function run(body: string) {
  execFileSync('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'], {
    input: `BEGIN; SET LOCAL request.jwt.claims='{"role":"service_role"}';
      INSERT INTO auth.users(id,email) VALUES('${buyer}','periods@example.com');
      INSERT INTO public.products(id,name,slug,price,currency,auto_grant_duration_days,allow_repeat_purchase)
        VALUES('${product}','Timed course','period-course',40,'PLN',30,true),('${parent}','Other course','period-parent',40,'PLN',NULL,true);
      ${body} ROLLBACK;`, encoding: 'utf8', stdio: ['pipe','pipe','pipe'],
  });
}
it('removes access when the earlier purchase period has expired @J34', () => {
  expect(() => run(`${order(a,40)}
    INSERT INTO public.user_product_access(user_id,product_id,access_granted_at,access_expires_at,access_duration_days) VALUES('${buyer}','${product}',now()-interval '40 days',now()-interval '10 days',30);
    ${order(b)}${grant(b)}${refund(b)}
    ${assertion(`NOT EXISTS(${access})`)}`)).not.toThrow();
});
it.each([a,b])('recalculates two thirty-day purchases after refunding %s @J34', id => {
  expect(() => run(`${order(a)}${grant(a)}${order(b)}${grant(b)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '60 days')`)}
    ${refund(id)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}
    ${refund(id)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}`)).not.toThrow();
});
it.each([a,b])('uses each remaining purchase start after refunding %s @J34', id => {
  const days = id === a ? 30 : 20;
  expect(() => run(`${order(a,10)}
    INSERT INTO public.user_product_access(user_id,product_id,access_granted_at,access_expires_at,access_duration_days) VALUES('${buyer}','${product}',now()-interval '10 days',now()+interval '20 days',30);
    ${order(b)}${grant(b)}${refund(id)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '${days} days')`)}`)).not.toThrow();
});
it('keeps saved duration when the product default changes @J34', () => {
  expect(() => run(`${order(a)}${grant(a)} UPDATE public.products SET auto_grant_duration_days=365 WHERE id='${product}';
    ${order(b)}${grant(b)}${refund(b)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}`)).not.toThrow();
});
it.each([0,7,null])('respects the saved add-on duration %s @J34', duration => {
  const expected = duration === 0 ? 'access_expires_at IS NULL' : `access_expires_at=now()+interval '${duration ?? 30} days'`;
  expect(() => run(`${order(a,0,parent)}
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency,access_duration_override)
      VALUES('${a}','${product}','order_bump',40,40,'PLN',${duration ?? 'NULL'});
    SELECT set_config('sellf.paid_order','${a}',true);
    SELECT public.grant_product_access_service_role('${buyer}','${product}',override_duration_days_param=>${duration ?? 'NULL'});
    SELECT set_config('sellf.paid_order','',true);
    ${order(b)}${grant(b)}${refund(b)}${assertion(`EXISTS(${access} AND ${expected})`)}`)).not.toThrow();
});
it('does not retain an expired legacy add-on with an explicit duration @J34', () => {
  expect(() => run(`${order(a,10,parent)}
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency,access_duration_override)
      VALUES('${a}','${product}','order_bump',40,40,'PLN',7);
    ${order(b)}${grant(b)}${refund(b)}${assertion(`NOT EXISTS(${access})`)}`)).not.toThrow();
});
it('dates a legacy guest period from its claim @J34', () => {
  expect(() => run(`${order(a,100)}
    INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_id,transaction_amount,claimed_by_user_id,claimed_at)
      VALUES('${product}','periods@example.com','cs_${a.replaceAll('-', '')}','${a}',4000,'${buyer}',now()-interval '10 days');
    ${order(b)}${grant(b)}${refund(b)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '20 days')`)}`)).not.toThrow();
});
it('recalculates component access from the remaining bundle period @J34', () => {
  expect(() => run(`UPDATE public.products SET is_bundle=true WHERE id='${parent}';
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id) VALUES('${parent}','${product}');
    ${order(a,0,parent)}${grant(a,parent)}${order(b)}${grant(b)}${refund(b)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}`)).not.toThrow();
});
it.each(['active','canceled'])('retains the %s subscription period instead of the refunded extension @J34', status => {
  expect(() => run(`${order(b)}${grant(b)}
    INSERT INTO public.subscriptions(user_id,product_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,paid_access_expires_at)
      VALUES('${buyer}','${product}','cus_period','sub_period','${status}',now()+interval '5 days',${status === 'canceled' ? "now()+interval '5 days'" : 'NULL'});
    ${refund(b)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '5 days')`)}`)).not.toThrow();
});
