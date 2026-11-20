/** Refunds retain only the current periods of the remaining sources. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import created from '../../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../../fixtures/stripe/charge_dispute_closed_won.json';
import { getTestDatabaseContainer } from '../../helpers/database-container';
const buyer = 'e2970000-0000-4000-a000-000000000001';
const product = 'e2970000-0000-4000-a000-000000000002';
const a = 'e2970000-0000-4000-a000-000000000003';
const b = 'e2970000-0000-4000-a000-000000000004';
const parent = 'e2970000-0000-4000-a000-000000000005';
const assertion = (predicate: string) => `DO $test$ BEGIN IF (${predicate}) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Remaining access period differs'; END IF; END $test$;`;
const apply = (event: typeof created | typeof won, closed: boolean) => { const d = event.data.object; return `SELECT public.apply_payment_dispute('${a}','${d.id}','${d.status}',${closed},'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created}));`; };
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
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${buyer}','periods@example.com',now());
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
    ${status === 'active' ? `UPDATE public.user_product_access SET subscription_id=(SELECT id FROM public.subscriptions WHERE stripe_subscription_id='sub_period'),access_expires_at=NULL WHERE user_id='${buyer}' AND product_id='${product}';` : ''}
    ${refund(b)}${assertion(`EXISTS(${access} AND ${status === 'active' ? 'access_expires_at IS NULL' : "access_expires_at=now()+interval '5 days'"})`)}`)).not.toThrow();
});

it('keeps the suspended grant available for a later won outcome without the refunded extension @J34', () => {
  expect(() => run(`${order(a)}${grant(a)}${order(b)}${grant(b)}${apply(created,false)}${refund(b)}
    ${assertion(`NOT EXISTS(${access} AND (access_expires_at IS NULL OR access_expires_at>now()))`)}
    ${apply(won,true)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}`)).not.toThrow();
});
it.each([5,-1])('does not extend a manually shortened deadline (%s days) during a refund @J34', days => {
  expect(() => run(`${order(a)}${grant(a)}${order(b)}${grant(b)}
    UPDATE public.user_product_access SET access_granted_at=now()-interval '40 days',access_expires_at=now()+make_interval(days=>${days}) WHERE user_id='${buyer}' AND product_id='${product}';
    ${refund(b)}${assertion(`EXISTS(${access} AND access_expires_at=now()+make_interval(days=>${days}))`)}`)).not.toThrow();
});
it('retains the longer term when one order contains the product as component and add-on @J34', () => {
  expect(() => run(`UPDATE public.products SET is_bundle=true WHERE id='${parent}';
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id) VALUES('${parent}','${product}');
    ${order(a,0,parent)}
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency,access_duration_override)
      VALUES('${a}','${product}','order_bump',40,40,'PLN',0);
    SELECT public._order_grant_and_record('${a}','${buyer}',NULL,'${buyer}',NULL,'none');
    ${order(b)}${grant(b)}${refund(b)}${assertion(`EXISTS(${access} AND access_expires_at IS NULL)`)}`)).not.toThrow();
});
it('retains a later manual bundle grant after the earlier bundle order was refunded @J34', () => {
  expect(() => run(`UPDATE public.products SET is_bundle=true WHERE id='${parent}';
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id) VALUES('${parent}','${product}');
    ${order(a,0,parent)}${grant(a,parent)}
    UPDATE public.payment_transactions SET status='refunded',refunded_amount=4000 WHERE id='${a}';
    SELECT public.revoke_order_product_access('${a}','${buyer}','${parent}');
    SELECT public.revoke_order_bundle_components('${a}','${buyer}');
    SELECT public.grant_product_and_bundle_components('${buyer}','${parent}');
    ${order(b)}${grant(b)}${refund(b)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}`)).not.toThrow();
});
it('records claimed add-ons against the claim when a prior fulfillment context exists @J34', () => {
  expect(() => run(`UPDATE auth.users SET email_confirmed_at=now() WHERE id='${buyer}';
    ${order(a)} SELECT public._order_grant_and_record('${a}','${buyer}',NULL,'${buyer}',NULL,'none');
    ${order(b,0,parent)} UPDATE public.payment_transactions SET user_id=NULL WHERE id='${b}';
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency,access_duration_override)
      VALUES('${b}','${product}','order_bump',40,40,'PLN',7);
    INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_id,transaction_amount)
      VALUES('${parent}','periods@example.com','cs_${b.replaceAll('-', '')}','${b}',4000);
    SELECT public.claim_guest_purchases_for_user('${buyer}');
    ${assertion(`(SELECT status='completed' FROM public.payment_transactions WHERE id='${b}')`)}
    ${assertion(`EXISTS(${access} AND transfer_transaction_id IS NULL)`)}
    ${assertion(`(SELECT access_terms ? '${buyer}:${product}' FROM public.payment_transactions WHERE id='${b}')`)}`)).not.toThrow();
});

it('retains the other purchase when refunding the disputed order itself @J34', () => {
  expect(() => run(`${order(a)}${grant(a)}${order(b)}${grant(b)}${apply(created,false)}${refund(a)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '30 days')`)}`)).not.toThrow();
});
it.each([10,120])('restores the won period alongside a remaining %s-day purchase after a refund @J34', days => {
  const third = 'e2970000-0000-4000-a000-000000000006';
  expect(() => run(`UPDATE public.products SET auto_grant_duration_days=90 WHERE id='${product}';
    ${order(a)}${grant(a)} UPDATE public.products SET auto_grant_duration_days=${days} WHERE id='${product}';
    ${order(b)}${grant(b)} UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${product}';
    ${order(third)}${grant(third)}${apply(created,false)}${refund(third)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '${days} days')`)}
    ${refund(third)}${apply(won,true)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '${Math.max(days,90)} days')`)}`)).not.toThrow();
});
it('keeps the disputed period after refunding a purchase made during the dispute @J34', () => {
  expect(() => run(`UPDATE public.products SET auto_grant_duration_days=90 WHERE id='${product}';
    ${order(a)}${grant(a)}${apply(created,false)}
    UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${product}';
    ${order(b)}${grant(b)}${refund(b)}${apply(won,true)}
    ${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '90 days')`)}`)).not.toThrow();
});
it('respects a manual deadline applied after a refund during a dispute @J34', () => {
  const third = 'e2970000-0000-4000-a000-000000000006';
  expect(() => run(`UPDATE public.products SET auto_grant_duration_days=90 WHERE id='${product}';
    ${order(a)}${grant(a)}${order(b)}${grant(b)}${order(third)}${grant(third)}${apply(created,false)}${refund(third)}
    UPDATE public.user_product_access SET access_expires_at=now()+interval '5 days' WHERE user_id='${buyer}' AND product_id='${product}';
    ${apply(won,true)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '5 days')`)}`)).not.toThrow();
});

it('respects a manual duration edit after a refund during a dispute @J34', () => {
  const third = 'e2970000-0000-4000-a000-000000000006';
  expect(() => run(`UPDATE public.products SET auto_grant_duration_days=90 WHERE id='${product}';
    ${order(a)}${grant(a)} UPDATE public.products SET auto_grant_duration_days=10 WHERE id='${product}';
    ${order(b)}${grant(b)}${order(third)}${grant(third)}${apply(created,false)}${refund(third)}
    UPDATE public.user_product_access SET access_duration_days=5 WHERE user_id='${buyer}' AND product_id='${product}';
    ${apply(won,true)}${assertion(`EXISTS(${access} AND access_expires_at=now()+interval '10 days' AND access_duration_days=5)`)}`)).not.toThrow();
});
