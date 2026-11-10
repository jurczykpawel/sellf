/** Every historical order reference must revoke main and bump licenses together. */
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
function sql(input: string): void {
  try { execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe','pipe','pipe'] }); }
  catch (error) { throw new Error((error as {stderr?:Buffer}).stderr?.toString() ?? String(error)); }
}
describe('order license revocation', () => {
  it.each(['session', 'intent', 'quick-pay', 'offline', 'invoice'].flatMap(kind=>['refund','cancel','subscription'].map(action=>({kind,action}))))('revokes all $kind order licenses on $action, preserving tokens and unrelated purchases', ({kind,action}) => {
    const tx=randomUUID(), main=randomUUID(), bump=randomUUID(), seller=randomUUID();
    const stripeRef=tx.replaceAll('-', '');
    const refs={session:`cs_${stripeRef}`,intent:`pi_${stripeRef}`,'quick-pay':tx,offline:tx,invoice:`in_${stripeRef}`};
    const ref=refs[kind as keyof typeof refs], hash=createHash('sha256').update(ref).digest('hex');
    sql(`BEGIN;
      INSERT INTO auth.users(id,email) VALUES ('${seller}','${seller}@example.com');
      INSERT INTO public.products(id,name,slug,price,currency,seller_id) VALUES
        ('${main}','Main','${main}',10,'PLN','${seller}'),('${bump}','Bump','${bump}',1,'PLN','${seller}');
      INSERT INTO public.payment_transactions(id,product_id,session_id,stripe_payment_intent_id,stripe_invoice_id,customer_email,amount,currency,status,payment_provider,pricing_snapshot_version,settled_via)
        VALUES('${tx}','${main}',${['quick-pay','offline'].includes(kind)?'NULL':`'cs_${stripeRef}'`},${kind==='offline'?'NULL':`'pi_${stripeRef}'`},'in_${stripeRef}','buyer@example.com',1100,'PLN','completed','${['quick-pay','offline'].includes(kind)?'bank_transfer':'stripe'}',1,${kind==='quick-pay'?"'stripe'":'NULL'});
      INSERT INTO public.issued_licenses(product_id,seller_id,email,order_id,kid,license_key) VALUES
        ('${main}','${seller}','buyer@example.com','${ref}','kid','original-main'),
        ('${bump}','${seller}','buyer@example.com','${ref}','kid','original-bump'),
        ('${main}','${seller}','buyer@example.com','free_${seller}_${main}','kid','unrelated');
      UPDATE public.payment_transactions SET status='partially_refunded',refunded_amount=100 WHERE id='${tx}';
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.issued_licenses WHERE order_id='${ref}' AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'partial revoked license'; END IF; END $$;
      ${action==='subscription' ? `SELECT set_config('request.jwt.claims','{"role":"service_role"}',true); SELECT * FROM public.revoke_order_licenses('${main}',ARRAY['in_${stripeRef}'],'subscription_cancelled');` : `UPDATE public.payment_transactions SET status='${action==='cancel'?'cancelled':'refunded'}',refunded_amount=${action==='cancel'?100:1100} WHERE id='${tx}';`}
      DO $$ BEGIN
        IF (SELECT count(*) FROM public.issued_licenses WHERE order_id='${ref}' AND revoked_at IS NOT NULL AND revocation_reason='${action==='cancel'?'manual':action==='subscription'?'subscription_cancelled':'refund'}')<>2 THEN RAISE EXCEPTION 'full refund left licenses active'; END IF;
        IF (SELECT count(*) FROM public.business_events WHERE event_type='license.revoked' AND product_id IN ('${main}','${bump}'))<>2 THEN RAISE EXCEPTION 'missing per-license events'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.seller_revoked_orders('${seller}','${hash.slice(0,4)}') WHERE order_hash='${hash}') THEN RAISE EXCEPTION 'CRL missing historical hash'; END IF;
        IF EXISTS(SELECT 1 FROM public.issued_licenses WHERE order_id='free_${seller}_${main}' AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'unrelated purchase revoked'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.issued_licenses WHERE order_id='${ref}' AND license_key='original-main') THEN RAISE EXCEPTION 'token changed'; END IF;
      END $$;
      ${action==='subscription' ? `SELECT * FROM public.revoke_order_licenses('${main}',ARRAY['in_${stripeRef}'],'subscription_cancelled');` : `UPDATE public.payment_transactions SET status=status WHERE id='${tx}';`}
      DO $$ BEGIN IF (SELECT count(*) FROM public.business_events WHERE event_type='license.revoked' AND product_id IN ('${main}','${bump}'))<>2 THEN RAISE EXCEPTION 'duplicate event'; END IF; END $$;
      ${action==='subscription' ? '' : `
      DELETE FROM public.issued_licenses WHERE product_id='${bump}' AND order_id='${ref}';
      INSERT INTO public.issued_licenses(product_id,seller_id,email,order_id,kid,license_key) VALUES
        ('${bump}','${seller}','buyer@example.com','${ref}','kid','delayed-fulfillment');
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.issued_licenses WHERE order_id='${ref}' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'late fulfillment resurrected order'; END IF; END $$;`}
      ROLLBACK;`);
  });
  it('repairs pre-migration refunded main and bump licenses and restricts the order RPC',()=>{
    const tx=randomUUID(),main=randomUUID(),bump=randomUUID(),seller=randomUUID();
    const migration=readFileSync(path.resolve(import.meta.dirname,'../../../../supabase/migrations/20261110010000_order_license_revocation.sql'),'utf8');
    const backfill=migration.slice(migration.indexOf('-- Repair existing full refunds'));
    sql(`BEGIN;
      INSERT INTO auth.users(id,email) VALUES('${seller}','${seller}@example.com');
      INSERT INTO public.products(id,name,slug,price,currency,seller_id) VALUES
        ('${main}','Historical main','${main}',10,'PLN','${seller}'),('${bump}','Historical bump','${bump}',1,'PLN','${seller}');
      INSERT INTO public.payment_transactions(id,product_id,session_id,customer_email,amount,currency,status,refunded_amount,payment_provider,pricing_snapshot_version)
        VALUES('${tx}','${main}',NULL,'buyer@example.com',1100,'PLN','refunded',1100,'bank_transfer',1);
      ALTER TABLE public.issued_licenses DISABLE TRIGGER revoke_license_for_disputed_order;
      INSERT INTO public.issued_licenses(product_id,seller_id,email,order_id,kid,license_key) VALUES
        ('${main}','${seller}','buyer@example.com','${tx}','kid','old-main'),
        ('${bump}','${seller}','buyer@example.com','${tx}','kid','old-bump');
      ALTER TABLE public.issued_licenses ENABLE TRIGGER revoke_license_for_disputed_order;
      ${backfill}
      DO $$ BEGIN
        IF (SELECT count(*) FROM public.issued_licenses WHERE order_id='${tx}' AND revoked_at IS NOT NULL AND revocation_reason='refund')<>2 THEN RAISE EXCEPTION 'historical licenses still active'; END IF;
        IF (SELECT count(*) FROM public.business_events WHERE event_type='license.revoked' AND product_id IN ('${main}','${bump}'))<>2 THEN RAISE EXCEPTION 'historical notifications missing'; END IF;
        IF has_function_privilege('anon','public.revoke_order_licenses(uuid,text[],text)','EXECUTE') OR has_function_privilege('authenticated','public.revoke_order_licenses(uuid,text[],text)','EXECUTE') THEN RAISE EXCEPTION 'order RPC exposed'; END IF;
      END $$;
      ROLLBACK;`);
  });

});
