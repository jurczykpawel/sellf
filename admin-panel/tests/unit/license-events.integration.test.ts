/** Licenses issued after a dispute stay revoked; every committed license change reaches integrators once. @see supabase/migrations/20261110235904_release_2026_11_0_fulfillment.sql */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import created from '../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../fixtures/stripe/charge_dispute_closed_won.json';
import lost from '../fixtures/stripe/charge_dispute_closed_lost.json';
import { getTestDatabaseContainer } from '../helpers/database-container';
import { readMigrationSource } from '../../scripts/migration-source';

const product = 'e1330000-0000-4000-a000-000000000001';
const seller = 'e1330000-0000-4000-a000-000000000002';
const tx = 'e1330000-0000-4000-a000-000000000003';
const license = 'e1330000-0000-4000-a000-000000000004';
const order = 'pi_w133_recorded';

function apply(event: typeof created | typeof won | typeof lost, closed = false): string {
  const d = event.data.object;
  return `SELECT public.apply_payment_dispute('${tx}','${d.id}','${d.status}',${closed},'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created}));`;
}
const issue = (expires = "now()+interval '30 days'", id = license, orderId = order) =>
  `INSERT INTO public.issued_licenses(id,seller_id,original_seller_id,product_id,email,order_id,kid,license_key,expires_at)
    VALUES('${id}','${seller}','${seller}','${product}','buyer-w133@example.com','${orderId}','kid-w133','e30.sig',${expires});`;
function run(body: string): void {
  const sql = `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO auth.users(id,email) VALUES('${seller}','seller-w133@example.com');
    INSERT INTO public.products(id,name,slug,price,currency) VALUES('${product}','License events','license-events-w133',11,'PLN');
    INSERT INTO public.payment_transactions(id,product_id,customer_email,session_id,stripe_payment_intent_id,amount,currency,status)
      VALUES('${tx}','${product}','buyer-w133@example.com','cs_w133','${order}',1100,'PLN','completed');
    ${body}
    ROLLBACK;`;
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const assert = (condition: string, message: string) => `DO $test$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $test$;`;
const events = (type: string) => `(SELECT count(*) FROM public.business_events WHERE product_id='${product}' AND event_type='${type}')`;
const revokedByDispute = (id: string) => `EXISTS(SELECT 1 FROM public.issued_licenses WHERE id='${license}' AND revoked_at IS NOT NULL AND revoked_by_dispute_id='${id}')`;

describe('license after dispute (B1)', () => {
  it('a license issued during an open dispute is revoked by it and returns after won @J195', () => {
    expect(() => run(`${apply(created)}${issue()}
      ${assert(revokedByDispute(created.data.object.id), 'License issued during a dispute must be revoked by it')}
      ${assert(`(SELECT revoked_license_ids='{${license}}'::uuid[] FROM public.payment_disputes WHERE stripe_dispute_id='${created.data.object.id}')`, 'Dispute must own the license')}
      ${assert(`(SELECT array_agg(event_type ORDER BY created_at,id)=ARRAY['license.issued','license.revoked'] FROM public.business_events WHERE product_id='${product}' AND event_type LIKE 'license.%')`, 'Integrator must see issued then revoked')}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.business_events WHERE product_id='${product}' AND payload::text LIKE '%e30.sig%')`, 'Events must not carry the token')}
      ${apply(created)}
      ${assert(`${events('license.revoked')}=1 AND (SELECT cardinality(revoked_license_ids)=1 FROM public.payment_disputes WHERE stripe_dispute_id='${created.data.object.id}')`, 'Retried dispute must not duplicate')}
      ${apply(won, true)}
      ${assert(`EXISTS(SELECT 1 FROM public.issued_licenses WHERE id='${license}' AND revoked_at IS NULL)`, 'Won must restore the license')}
      ${assert(`${events('license.restored')}=1`, 'Integrator must see the restoration')}`)).not.toThrow();
  });
  it('a license issued after a lost dispute stays revoked', () => {
    expect(() => run(`${apply(created)}${apply(lost, true)}${issue()}
      ${assert(`EXISTS(SELECT 1 FROM public.issued_licenses WHERE id='${license}' AND revoked_at IS NOT NULL)`, 'License after lost must be revoked')}
      ${assert(`${events('license.revoked')}=1`, 'Integrator must see the revocation')}`)).not.toThrow();
  });
  it('a license issued after won, or for another order, stays active', () => {
    expect(() => run(`${apply(created)}${apply(won, true)}${issue()}
      ${issue("NULL", 'e1330000-0000-4000-a000-000000000005', 'manual_other')}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.issued_licenses WHERE product_id='${product}' AND revoked_at IS NOT NULL)`, 'Licenses must stay active')}
      ${assert(`${events('license.issued')}=2 AND ${events('license.revoked')}=0`, 'Only issued events')}`)).not.toThrow();
  });
});

describe('license expiry events', () => {
  it('notifies one expiry per lapsed active license @J196', () => {
    expect(() => run(`${issue("now()-interval '1 minute'")}
      ${issue("now()-interval '1 minute'", 'e1330000-0000-4000-a000-000000000005', 'revoked_order')}
      SELECT public.revoke_issued_licenses(ARRAY['e1330000-0000-4000-a000-000000000005'::uuid]);
      ${issue("now()+interval '1 day'", 'e1330000-0000-4000-a000-000000000006', 'future_order')}
      SELECT public.capture_expired_licenses();SELECT public.capture_expired_licenses();
      ${assert(`${events('license.expired')}=1`, 'Exactly one expiry for the active lapsed license')}
      ${assert(`(SELECT payload->'licenseRow'->>'id'='${license}' FROM public.business_events WHERE product_id='${product}' AND event_type='license.expired')`, 'Expiry identifies the license')}`)).not.toThrow();
  });
});

describe('buyer mail language', () => {
  it('prefers the latest order locale, then the account locale, else unknown', () => {
    expect(() => run(`
      ${assert(`public.buyer_mail_locale('buyer-w133@example.com') IS NULL`, 'Unknown buyer has no language')}
      UPDATE auth.users SET raw_user_meta_data='{"locale":"en"}' WHERE id='${seller}';
      ${assert(`public.buyer_mail_locale('SELLER-w133@example.com')='en'`, 'Account language is used')}
      UPDATE public.payment_transactions SET metadata='{"locale":"pl"}' WHERE id='${tx}';
      ${assert(`public.buyer_mail_locale('buyer-w133@example.com')='pl'`, 'Order language is used')}`)).not.toThrow();
  });
});

describe('business event type constraint keeps every family', () => {
  it('accepts all W134 event families and all license events', () => {
    const w134 = readMigrationSource('20261103130000_webhook_event_families.sql');
    const listed = w134.slice(w134.indexOf('business_events_event_type_check CHECK'), w134.indexOf('));', w134.indexOf('business_events_event_type_check CHECK')));
    const types = [...new Set([...listed.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]).concat(['license.issued', 'license.expired']))];
    expect(types.length).toBeGreaterThan(25);
    expect(() => run(types.map(type => `INSERT INTO public.business_events(event_type,product_id,payload) VALUES('${type}','${product}','{}');`).join('\n'))).not.toThrow();
    const def = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-tAc',
      "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='business_events_event_type_check'"], { encoding: 'utf8' });
    for (const type of types) expect(def).toContain(`'${type}'`);
  });
});

it('captures the license customer account in the issued event for receivers', () => {
  expect(() => run(`INSERT INTO public.issued_licenses(id,seller_id,original_seller_id,product_id,user_id,email,order_id,kid,license_key)
    VALUES('${license}','${seller}','${seller}','${product}','${seller}','seller-w133@example.com','manual_consumer','kid','e30.sig');
    ${assert(`EXISTS(SELECT 1 FROM public.business_events WHERE product_id='${product}' AND event_type='license.issued' AND payload->'licenseRow'->>'user_id'='${seller}')`, 'Issued license identifies customer account')}`)).not.toThrow();
});
