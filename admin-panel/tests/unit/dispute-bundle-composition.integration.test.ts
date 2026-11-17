/**
 * A dispute on a bundle order suspends the components that order granted, not the bundle's current
 * composition: a component removed later is still suspended, and a component added later (which the
 * buyer owns from another purchase) stays active.
 * @see supabase/migrations/20261117140000_order_entitlement_fixes.sql
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import created from './../fixtures/stripe/charge_dispute_created_needs_response.json';
import { getTestDatabaseContainer } from '../helpers/database-container';

const ids = {
  bundle: 'e2640000-0000-4000-a000-000000000001',
  kept: 'e2640000-0000-4000-a000-000000000002',
  removed: 'e2640000-0000-4000-a000-000000000003',
  added: 'e2640000-0000-4000-a000-000000000004',
  buyer: 'e2640000-0000-4000-a000-000000000005',
  tx: 'e2640000-0000-4000-a000-000000000006',
  other: 'e2640000-0000-4000-a000-000000000007',
};
const d = created.data.object;

function run(body: string): void {
  const sql = `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${ids.buyer}','dispute-bundle@example.com',now());
    INSERT INTO public.products(id,name,slug,price,currency,is_bundle) VALUES
      ('${ids.bundle}','Bundle','w264-bundle',40,'PLN',true),('${ids.kept}','Kept','w264-kept',10,'PLN',false),
      ('${ids.removed}','Removed','w264-removed',10,'PLN',false),('${ids.added}','Added','w264-added',10,'PLN',false);
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id,display_order) VALUES
      ('${ids.bundle}','${ids.kept}',0),('${ids.bundle}','${ids.removed}',1);
    INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,amount,currency,status)
      VALUES('${ids.tx}','${ids.bundle}','${ids.buyer}','dispute-bundle@example.com','cs_w264_bundle',4000,'PLN','completed');
    SELECT public.grant_product_and_bundle_components('${ids.buyer}','${ids.bundle}');
    INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,amount,currency,status)
      VALUES('${ids.other}','${ids.added}','${ids.buyer}','dispute-bundle@example.com','cs_w264_other',1000,'PLN','completed');
    SELECT public.grant_product_access_service_role('${ids.buyer}','${ids.added}');
    DELETE FROM public.bundle_items WHERE bundle_product_id='${ids.bundle}' AND component_product_id='${ids.removed}';
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id,display_order) VALUES('${ids.bundle}','${ids.added}',2);
    SELECT public.apply_payment_dispute('${ids.tx}','${d.id}','${d.status}',false,'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created}));
    ${body}
    ROLLBACK;`;
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const active = (product: string) => `EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='${ids.buyer}' AND product_id='${product}' AND (access_expires_at IS NULL OR access_expires_at>clock_timestamp()))`;
const assert = (condition: string, message: string) => `DO $test$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $test$;`;

describe('dispute on a re-composed bundle @J38', () => {
  it('suspends every component the order granted, including one removed from the bundle later @J38', () => {
    expect(() => run(`${assert(`NOT ${active(ids.kept)}`, 'Kept component must be suspended')}
      ${assert(`NOT ${active(ids.removed)}`, 'Component the order granted must be suspended')}
      ${assert(`NOT ${active(ids.bundle)}`, 'Bundle must be suspended')}`)).not.toThrow();
  });

  it('keeps a component added to the bundle later that the buyer bought separately @J38', () => {
    expect(() => run(assert(active(ids.added), 'Separately bought component must stay active'))).not.toThrow();
  });
});
