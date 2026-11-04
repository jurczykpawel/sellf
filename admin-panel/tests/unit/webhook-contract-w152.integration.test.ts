/**
 * Integrator contract fixes from the W147 receiver run (W152): why access and licenses were
 * revoked, one access.updated per subscription period, Sellf order identity on license events,
 * consistent buyer identity on seat events, deferred renewal notices and the admin cancel note.
 * @see supabase/migrations/20261104030000_webhook_contract_w152.sql
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../helpers/database-container';

const product = 'e1520000-0000-4000-a000-000000000001';
const buyer = 'e1520000-0000-4000-a000-000000000002';
const tx = 'e1520000-0000-4000-a000-000000000003';
const sub = 'e1520000-0000-4000-a000-000000000004';
const license = 'e1520000-0000-4000-a000-000000000005';
const email = 'buyer-w152@example.com';

function run(body: string): void {
  const sql = `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${buyer}','${email}',now());
    INSERT INTO public.products(id,name,slug,price,currency) VALUES('${product}','Contract W152','contract-w152',15,'PLN');
    INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,status,current_period_end)
      VALUES('${sub}','${buyer}','${product}','cus_w152','sub_w152','active','2026-12-04T10:00:00Z');
    INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,stripe_payment_intent_id,amount,currency,status)
      VALUES('${tx}','${product}','${buyer}','${email}','cs_w152','pi_w152',1500,'PLN','completed');
    ${body}
    ROLLBACK;`;
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const assert = (condition: string, message: string) => `DO $test$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $test$;`;
const latest = (type: string) => `(SELECT payload FROM public.business_events WHERE product_id='${product}' AND event_type='${type}' ORDER BY created_at DESC,id DESC LIMIT 1)`;
const count = (type: string) => `(SELECT count(*) FROM public.business_events WHERE product_id='${product}' AND event_type='${type}')`;
const grant = (extra = '') => `INSERT INTO public.user_product_access(id,user_id,product_id${extra ? ',subscription_id' : ''})
  VALUES('e1520000-0000-4000-a000-0000000000a1','${buyer}','${product}'${extra ? `,'${extra}'` : ''});`;
const deleteAccess = `DELETE FROM public.user_product_access WHERE id='e1520000-0000-4000-a000-0000000000a1';`;
const issue = (id = license, order = 'pi_w152') => `INSERT INTO public.issued_licenses(id,seller_id,original_seller_id,product_id,email,order_id,kid,license_key,expires_at)
  VALUES('${id}','${buyer}','${buyer}','${product}','${email}','${order}','kid-w152','e30.sig',now()+interval '30 days');`;

describe('access.revoked says why access ended (W147-1)', () => {
  it.each([
    ['refund', `UPDATE public.payment_transactions SET status='refunded' WHERE id='${tx}';${grant()}${deleteAccess}`],
    ['manual', `${grant()}SELECT public.mutate_access('revoke','${buyer}',NULL,'e1520000-0000-4000-a000-0000000000a1','{}','{"type":"api_key","id":"e1520000-0000-4000-a000-0000000000ff"}');`],
    ['dispute', `${grant()}SELECT set_config('sellf.event_context','{"reason":"stripe_dispute"}',true);${deleteAccess}`],
    ['subscription_cancelled', `${grant(sub)}UPDATE public.subscriptions SET status='canceled' WHERE id='${sub}';${deleteAccess}`],
  ])('%s @J280', (reason, body) => {
    expect(() => run(`${body}
      ${assert(`${latest('access.revoked')}->>'revocationReason'='${reason}'`, `access.revoked must carry ${reason}`)}`)).not.toThrow();
  });
  it('keeps the legacy origin reason next to the new field', () => {
    expect(() => run(`UPDATE public.payment_transactions SET status='refunded' WHERE id='${tx}';${grant()}${deleteAccess}
      ${assert(`${latest('access.revoked')}->>'reason'='purchase'`, 'Legacy reason unchanged')}`)).not.toThrow();
  });
  it('natural expiry reports expired', () => {
    expect(() => run(`INSERT INTO public.user_product_access(user_id,product_id,access_granted_at,created_at,access_expires_at)
        VALUES('${buyer}','${product}','1999-01-01','1999-01-01','2000-01-01');
      SELECT public.capture_expired_access();
      ${assert(`${latest('access.expired')}->>'revocationReason'='expired'`, 'access.expired must carry expired')}`)).not.toThrow();
  });
});

describe('license.revoked says why (W147-2) and license events identify the Sellf order', () => {
  it.each([['refund', 'NULL'], ['manual', `'${buyer}'`], ['subscription_cancelled', 'NULL']])('%s @J281', (reason, actor) => {
    expect(() => run(`${issue()}
      SELECT public.revoke_issued_licenses(ARRAY['${license}'::uuid],${actor},'${reason}');
      ${assert(`${latest('license.revoked')}->'licenseRow'->>'revocation_reason'='${reason}'`, `license.revoked must carry ${reason}`)}`)).not.toThrow();
  });
  it('a license revoked by a dispute reports dispute', () => {
    expect(() => run(`${issue()}
      SELECT public.apply_payment_dispute('${tx}','dp_w152','needs_response',false,'fraudulent',1500,'pln',now());
      ${assert(`${latest('license.revoked')}->'licenseRow'->>'revocation_reason'='dispute'`, 'Dispute revocation must say dispute')}`)).not.toThrow();
  });
  it('license.issued carries the Sellf order id and number, not only pi_ @J282', () => {
    expect(() => run(`${issue()}
      ${assert(`${latest('license.issued')}->'licenseRow'->>'sellf_order_id'='${tx}'`, 'Order id')}
      ${assert(`(${latest('license.issued')}->'licenseRow'->>'order_number')::bigint=(SELECT order_number FROM public.payment_transactions WHERE id='${tx}')`, 'Order number')}
      ${assert(`${latest('license.issued')}->'licenseRow'->>'revocation_reason' IS NULL`, 'Active license has no revocation reason')}`)).not.toThrow();
  });
});

describe('subscription access.updated once per period with its end (W147-3)', () => {
  it('a renewed period notifies once; unchanged periods stay silent @J283', () => {
    expect(() => run(`${grant(sub)}
      UPDATE public.subscriptions SET updated_at=now(),status='active' WHERE id='${sub}';
      ${assert(`${count('access.updated')}=0`, 'No change, no event')}
      UPDATE public.subscriptions SET current_period_end='2027-01-04T10:00:00Z' WHERE id='${sub}';
      UPDATE public.subscriptions SET current_period_end='2027-01-04T10:00:00Z',updated_at=now() WHERE id='${sub}';
      ${assert(`${count('access.updated')}=1`, 'Exactly one update for the new period')}
      ${assert(`(${latest('access.updated')}->>'accessEndsAt')::timestamptz='2027-01-04T10:00:00Z'`, 'Update carries the access end')}
      ${assert(`(${latest('access.granted')}->>'accessEndsAt')::timestamptz='2026-12-04T10:00:00Z'`, 'Grant carries the access end')}`)).not.toThrow();
  });
});

describe('seat events identify the buyer like order events (W147-11)', () => {
  it('fills customer.userId from the account of the order email', () => {
    expect(() => run(`INSERT INTO public.business_events(event_type,product_id,payload)
        VALUES('seats.released','${product}',jsonb_build_object('customer',jsonb_build_object('userId',NULL,'email','${email.toUpperCase()}')));
      ${assert(`${latest('seats.released')}->'customer'->>'userId'='${buyer}'`, 'Seat event must carry the account id')}`)).not.toThrow();
  });
});

describe('renewal notice waits for the window before renewal (W147-12)', () => {
  it('emits a due notice once, and none for a canceled subscription @J284', () => {
    expect(() => run(`UPDATE public.subscriptions SET renewal_notice_at=now()-interval '1 minute',
        renewal_notice_payload='{"subscription":{"stripeSubscriptionId":"sub_w152"}}' WHERE id='${sub}';
      SELECT public.capture_due_renewal_notices();SELECT public.capture_due_renewal_notices();
      ${assert(`${count('subscription.renewal_upcoming')}=1`, 'One due notice')}
      ${assert(`${latest('subscription.renewal_upcoming')}->'subscription'->>'stripeSubscriptionId'='sub_w152'`, 'Notice payload')}
      UPDATE public.subscriptions SET renewal_notice_at=now()-interval '1 minute',status='canceled',
        renewal_notice_payload='{"subscription":{}}' WHERE id='${sub}';
      SELECT public.capture_due_renewal_notices();
      ${assert(`${count('subscription.renewal_upcoming')}=1`, 'Canceled subscription gets no notice')}
      ${assert(`(SELECT renewal_notice_at IS NULL FROM public.subscriptions WHERE id='${sub}')`, 'Stale notice cleared')}`)).not.toThrow();
  });
});

describe('admin cancellation keeps its text (W147-11)', () => {
  it('records the reason text on the order', () => {
    expect(() => run(`UPDATE public.payment_transactions SET payment_provider='bank_transfer',status='awaiting_payment',stripe_payment_intent_id=NULL,session_id=NULL,pricing_snapshot_version=1 WHERE id='${tx}';
      SELECT public.cancel_unpaid_order('${tx}','Klient zrezygnowal');
      ${assert(`(SELECT cancel_note='Klient zrezygnowal' FROM public.payment_transactions WHERE id='${tx}')`, 'Cancel note stored')}`)).not.toThrow();
  });
});
