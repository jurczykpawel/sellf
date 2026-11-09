/** Recorded dispute outcomes must preserve the buyer's entitlement and receiver decision. */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import created from '../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../fixtures/stripe/charge_dispute_closed_won.json';
import lost from '../fixtures/stripe/charge_dispute_closed_lost.json';
import { getTestDatabaseContainer } from '../helpers/database-container';

const product = 'e1170000-0000-4000-a000-000000000001';
const buyer = 'e1170000-0000-4000-a000-000000000002';
const tx = 'e1170000-0000-4000-a000-000000000003';
const grant = 'e1170000-0000-4000-a000-000000000004';
const subscription = 'e1170000-0000-4000-a000-000000000005';
const expires = "now()+interval '30 days'";
function apply(event: typeof created | typeof won | typeof lost, closed = false): string {
  const d = event.data.object;
  return `SELECT public.apply_payment_dispute('${tx}','${d.id}','${d.status}',${closed},'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created}));`;
}
function run(body: string, guest = false, status = 'completed'): void {
  const setup = `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO public.products(id,name,slug,price,currency) VALUES('${product}','Dispute contract','dispute-contract',11,'PLN');
    INSERT INTO auth.users(id,email) VALUES('${buyer}','dispute-contract@example.com');
    INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,stripe_payment_intent_id,amount,currency,status,refunded_amount)
      VALUES('${tx}','${product}',${guest ? 'NULL' : `'${buyer}'`},'dispute-contract@example.com','pi_recorded6','pi_recorded6',1100,'PLN','${status}',${status === 'partially_refunded' ? 100 : 0});
    ${guest ? `INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_amount,transaction_id,metadata,created_at)
      VALUES('${product}','dispute-contract@example.com','pi_recorded6',1100,'${tx}','{"original":"kept"}',now()-interval '1 day');` : `INSERT INTO public.user_product_access(id,user_id,product_id,access_granted_at,access_expires_at,access_duration_days)
      VALUES('${grant}','${buyer}','${product}',now()-interval '1 day',${expires},30);`}
    ${body}
    ROLLBACK;`;
  execFileSync('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-U','postgres','-v','ON_ERROR_STOP=1'], { input: setup, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
}
const assert = (condition: string, message: string) => `DO $test$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $test$;`;

describe('dispute buyer and receiver contract', () => {
  it.each(['completed','partially_refunded'])('restores %s and the original account expiry after won', status => {
    expect(() => run(`${apply(created)}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND (access_expires_at IS NULL OR access_expires_at>clock_timestamp()))`, 'Disputed access must be inactive')}
      ${apply(won, true)}
      ${assert(`(SELECT status='${status}' FROM public.payment_transactions WHERE id='${tx}')`, 'Payment must leave disputed')}
      ${assert(`EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND access_expires_at=${expires} AND access_granted_at=now()-interval '1 day')`, 'Original expiry and grant time must return')}
      ${assert(`(SELECT (payload->'dispute'->>'accessRestored')::boolean FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Receiver must know access returned')}
      ${assert(`(SELECT (payload->'dispute'->'restoredAccess'->0->>'expiresAt')::timestamptz=${expires} FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Receiver must know the restored deadline')}
      ${apply(won, true)}${apply(created)}
      ${assert(`(SELECT count(*)=1 FROM public.user_product_access WHERE id='${grant}')`, 'Repeated outcomes must retain one grant')}
      ${assert(`(SELECT status='${status}' FROM public.payment_transactions WHERE id='${tx}')`, 'Late created must not regress won')}`, false, status)).not.toThrow();
  });
  it('publishes inactive access when a grant and its suspension share a transaction', () => {
    expect(() => run(`UPDATE public.user_product_access SET access_granted_at=now() WHERE id='${grant}';
      ${apply(created)}
      ${assert(`EXISTS(SELECT 1 FROM public.business_events WHERE product_id='${product}' AND payload->>'reason'='stripe_dispute' AND payload->'access'->>'statusAfter'='expired')`, 'Receiver must see the suspension as inactive')}
      ${apply(won,true)}
      ${assert(`EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND access_granted_at=now() AND access_expires_at=${expires})`, 'Immediate suspension must preserve the original dates')}`)).not.toThrow();
  });
  it('does not turn suspension or repeated delivery into extra expiry notifications', () => {
    expect(() => run(`${apply(created)}
      UPDATE public.user_product_access SET access_expires_at=now()-interval '1 hour',
        expiry_notified_at=CASE WHEN expiry_notified_at IS NULL THEN NULL ELSE now()-interval '1 hour' END WHERE id='${grant}';
      UPDATE public.payment_disputes SET suspended_at=now()-interval '1 hour' WHERE stripe_dispute_id='${created.data.object.id}';
      SELECT public.capture_expired_access();${apply(created)}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.business_events WHERE product_id='${product}' AND event_type='access.expired')`, 'Dispute suspension must not become a separate expiry')}
      ${assert(`(SELECT count(*)=2 FROM public.business_events WHERE product_id='${product}' AND event_type='access.updated')`, 'Repeated dispute must not duplicate access changes')}`)).not.toThrow();
  });
  it('lists only the restored add-on when the main grant was manually removed', () => {
    const addon='e1170000-0000-4000-a000-000000000006';
    expect(() => run(`INSERT INTO public.products(id,name,slug,price,currency) VALUES('${addon}','Dispute add-on','dispute-addon',5,'PLN');
      INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency)
        VALUES('${tx}','${addon}','order_bump',5,5,'PLN');
      INSERT INTO public.user_product_access(user_id,product_id,access_granted_at,access_expires_at)
        VALUES('${buyer}','${addon}',now()-interval '1 day',now()+interval '10 days');
      ${apply(created)}
      SELECT public.mutate_access('revoke','${buyer}',NULL,'${grant}','{}','{"type":"user","id":"${buyer}"}');
      ${apply(won,true)}
      ${assert(`(SELECT jsonb_array_length(payload->'dispute'->'restoredAccess')=1 AND payload->'dispute'->'restoredAccess'->0->>'productId'='${addon}' FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Receiver must not restore the removed main product')}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}')`, 'Main grant must remain removed')}`)).not.toThrow();
  });
  it('restores the exact unclaimed guest purchase after won', () => {
    expect(() => run(`${apply(created)}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id='${tx}')`, 'Guest cannot claim during dispute')}
      ${apply(won,true)}${apply(won,true)}
      ${assert(`(SELECT count(*)=1 FROM public.guest_purchases WHERE transaction_id='${tx}' AND created_at=now()-interval '1 day' AND metadata->>'original'='kept' AND claimed_by_user_id IS NULL)`, 'Original guest entitlement must return exactly once')}`, true)).not.toThrow();
  });
  it('preserves a finite guest term when the restored purchase is claimed later', () => {
    expect(() => run(`UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${product}';
      ${apply(created)}
      UPDATE auth.users SET email_confirmed_at=now() WHERE id='${buyer}';
      ${apply(won,true)}
      ${assert(`(SELECT (payload->'dispute'->'restoredAccess'->0->>'expiresAt')::timestamptz=now()+interval '29 days' FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Receiver must know the original guest deadline')}
      UPDATE public.products SET auto_grant_duration_days=60 WHERE id='${product}';
      SELECT public.claim_guest_purchases_for_user('${buyer}');
      ${assert(`EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='${buyer}' AND product_id='${product}' AND access_expires_at=now()+interval '29 days')`, 'Guest must retain purchase date plus original duration')}
      ${assert(`EXISTS(SELECT 1 FROM public.business_events WHERE product_id='${product}' AND event_type='access.granted' AND (payload->>'accessExpiresAt')::timestamptz=now()+interval '29 days')`, 'The receiver must get the original guest expiry')}`,true)).not.toThrow();
  });
  it('retains the restored guest term alongside a refunded order for the same product @J185', () => {
    expect(() => run(`UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${product}';
      ${apply(created)}
      UPDATE auth.users SET email_confirmed_at=now() WHERE id='${buyer}';
      WITH inserted AS (
        INSERT INTO public.payment_transactions(product_id,customer_email,payment_provider,pricing_snapshot_version,amount,currency,status)
          VALUES('${product}','dispute-contract@example.com','bank_transfer',1,1100,'PLN','refunded') RETURNING id
      ) INSERT INTO public.guest_purchases(product_id,customer_email,transaction_amount,transaction_id)
        SELECT '${product}','dispute-contract@example.com',1100,id FROM inserted;
      UPDATE public.products SET auto_grant_duration_days=60 WHERE id='${product}';
      ${apply(won,true)}
      ${assert(`EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='${buyer}' AND product_id='${product}' AND access_expires_at=now()+interval '29 days')`, 'Restored term changed')}`,true)).not.toThrow();
  });
  it('does not restore a guest purchase whose original term elapsed before resolution', () => {
    expect(() => run(`UPDATE public.products SET auto_grant_duration_days=1 WHERE id='${product}';
      UPDATE public.guest_purchases SET created_at=now()-interval '2 days' WHERE transaction_id='${tx}';
      ${apply(created)}${apply(won,true)}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id='${tx}')`, 'An elapsed guest term must not reopen')}
      ${assert(`(SELECT NOT (payload->'dispute'->>'accessRestored')::boolean FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Expired guest must stay unrestored')}`,true)).not.toThrow();
  });
  it.each(['refund','manual','expired'])('does not restore access after %s', reason => {
    const mutation = reason === 'refund' ? `UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${tx}'; DELETE FROM public.user_product_access WHERE id='${grant}';`
      : reason === 'manual' ? `SELECT public.mutate_access('revoke','${buyer}',NULL,'${grant}','{}','{"type":"user","id":"${buyer}"}');`
        : `UPDATE public.user_product_access SET access_expires_at=now()-interval '1 hour' WHERE id='${grant}';`;
    expect(() => run(`${apply(created)}${mutation}${apply(won,true)}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND (access_expires_at IS NULL OR access_expires_at>clock_timestamp()))`, 'Won must respect later access decisions')}
      ${assert(`(SELECT NOT (payload->'dispute'->>'accessRestored')::boolean FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Receiver must not claim restoration')}`)).not.toThrow();
  });
  it('keeps a subscription refresh suspended until the outcome is known', () => {
    expect(() => run(`${apply(created)}
      UPDATE public.user_product_access SET access_granted_at=clock_timestamp() WHERE id='${grant}';
      ${assert(`NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND access_expires_at>clock_timestamp())`, 'Subscription refresh must not grant disputed access')}
      ${apply(won,true)}
      ${assert(`EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND access_expires_at=${expires} AND access_granted_at=now()-interval '1 day')`, 'Subscription refresh must preserve the original term')}`)).not.toThrow();
  });
  it('keeps revoked licenses revoked after a successful access restoration', () => {
    expect(() => run(`INSERT INTO public.issued_licenses(seller_id,product_id,user_id,order_id,kid,license_key,revoked_at)
      VALUES('${buyer}','${product}','${buyer}','pi_recorded6','fixture-kid','fixture-token',now());
      ${apply(created)}${apply(won,true)}
      ${assert(`EXISTS(SELECT 1 FROM public.issued_licenses WHERE product_id='${product}' AND revoked_at IS NOT NULL)`, 'CRL entry must remain revoked')}`)).not.toThrow();
  });
  it.each(['active','canceled'])('respects the %s subscription and its paid access period', state => {
    expect(() => run(`INSERT INTO public.subscriptions(id,stripe_subscription_id,product_id,user_id,stripe_customer_id,status,current_period_end)
      VALUES('${subscription}','sub_fixture_dispute','${product}','${buyer}','cus_fixture','active',${expires});
      UPDATE public.payment_transactions SET subscription_id='${subscription}' WHERE id='${tx}';
      UPDATE public.user_product_access SET subscription_id='${subscription}' WHERE id='${grant}';
      ${apply(created)}
      UPDATE public.subscriptions SET status='${state}' WHERE id='${subscription}';
      ${apply(won,true)}
      ${assert(`(SELECT (payload->'dispute'->>'accessRestored')::boolean=${state === 'active'} FROM public.payment_disputes WHERE stripe_dispute_id='${won.data.object.id}')`, 'Subscription entitlement must match its current state')}
      ${assert(`(SELECT count(*)=${state === 'active' ? 1 : 0} FROM public.user_product_access WHERE id='${grant}' AND access_expires_at=${expires})`, 'Subscription must not receive extra time')}`)).not.toThrow();
  });
  it('restores access for a guest who confirmed email while the dispute was open', () => {
    expect(() => run(`UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${product}';
      UPDATE auth.users SET email_confirmed_at=NULL WHERE id='${buyer}';
      ${apply(created)}
      UPDATE auth.users SET email_confirmed_at=now() WHERE id='${buyer}';
      ${apply(won,true)}
      ${assert(`EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='${buyer}' AND product_id='${product}' AND access_expires_at=now()+interval '29 days')`, 'Confirmed buyer must receive original access deadline')}
      ${assert(`EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id='${tx}' AND claimed_by_user_id='${buyer}')`, 'Restored purchase must be claimed')}
      ${apply(won,true)}
      ${assert(`(SELECT count(*)=1 FROM public.user_product_access WHERE user_id='${buyer}' AND product_id='${product}')`, 'Repeated win retains one grant')}`, true)).not.toThrow();
  });
  it('keeps lost access inactive and denies client execution', () => {
    expect(() => run(`${apply(lost,true)}
      ${assert(`(SELECT status='disputed' FROM public.payment_transactions WHERE id='${tx}')`, 'Lost must stay disputed')}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE id='${grant}' AND access_expires_at>clock_timestamp())`, 'Lost access must stay inactive')}
      ${assert(`NOT has_function_privilege('authenticated','public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz)','EXECUTE')`, 'Only service can change disputes')}
      ${assert(`NOT has_table_privilege('authenticated','public.payment_disputes','SELECT')`, 'Snapshots are internal')}
      GRANT SELECT ON public.payment_disputes TO authenticated;
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"role":"authenticated"}';
      ${assert(`NOT EXISTS(SELECT 1 FROM public.payment_disputes)`, 'RLS must keep snapshots private')}
      RESET ROLE;`)).not.toThrow();
  });
});
