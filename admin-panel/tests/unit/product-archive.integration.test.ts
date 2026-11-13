/**
 * Product archive contract at the database layer.
 *
 * "Delete" of a product with sales history moves it to the archive; a permanent delete
 * (only from the archive) never removes orders, invoices or licenses — they keep the
 * product name from the time of purchase.
 *
 * @see supabase/migrations/20261114100000_product_archive.sql
 */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../helpers/database-container';

function sql(body: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; SET LOCAL request.jwt.claims='{"role":"service_role"}'; ${body} ROLLBACK;`, encoding: 'utf8',
  });
}
const assert = (condition: string, message: string) => `DO $$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $$;`;
const productEvents = (type: string) => `(SELECT count(*) FROM public.business_events,p WHERE business_events.product_id=p.id AND event_type='${type}')`;

/** A product sold once: completed order, line item, invoice, refund request, license and buyer access. */
const soldProduct = `
  CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id, gen_random_uuid() AS tx, (SELECT user_id FROM public.admin_users LIMIT 1) AS admin;
  INSERT INTO public.products(id,name,slug,price,currency) SELECT id,'Archive course','w250-'||id,49,'PLN' FROM p;
  INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id)
    SELECT tx,id,'w250-buyer@example.com',4900,'PLN','completed','cs_w250_'||replace(tx::text,'-','') FROM p;
  INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency,product_name)
    SELECT tx,id,'main_product',4900,4900,'PLN','Archive course' FROM p;
  INSERT INTO public.invoices(transaction_id,provider,external_key,provider_domain)
    SELECT tx,'fakturownia','w250-'||tx,'w250.example.com' FROM p;
  INSERT INTO public.refund_requests(transaction_id,customer_email,product_id,requested_amount,currency)
    SELECT tx,'w250-buyer@example.com',id,4900,'PLN' FROM p;
  INSERT INTO public.issued_licenses(seller_id,original_seller_id,product_id,email,order_id,kid,license_key)
    SELECT admin,admin,id,'w250-buyer@example.com',tx::text,'w250-kid','w250-token-'||tx FROM p;
  INSERT INTO public.user_product_access(user_id,product_id,grant_source) SELECT admin,id,'purchase' FROM p;
  UPDATE public.products SET name='Archive course (renamed)' WHERE id=(SELECT id FROM p);
`;

it('a direct product delete keeps orders, invoices and licenses with the product name from purchase time', () => {
  expect(sql(`${soldProduct}
    DELETE FROM public.products WHERE id=(SELECT id FROM p);
    ${assert(`(SELECT product_id IS NULL AND product_name='Archive course' AND status='completed' FROM public.payment_transactions,p WHERE payment_transactions.id=p.tx)`, 'order must survive with purchase-time name')}
    ${assert(`(SELECT product_id IS NULL AND product_name='Archive course' FROM public.payment_line_items,p WHERE transaction_id=p.tx)`, 'line item must survive')}
    ${assert(`(SELECT count(*)=1 FROM public.invoices,p WHERE transaction_id=p.tx)`, 'invoice must survive')}
    ${assert(`(SELECT product_id IS NULL FROM public.refund_requests,p WHERE transaction_id=p.tx)`, 'refund request must survive')}
    ${assert(`(SELECT product_id IS NULL AND product_name='Archive course' AND license_key LIKE 'w250-token-%' FROM public.issued_licenses,p WHERE order_id=p.tx::text)`, 'license must survive with purchase-time name')}
    ${assert(`(SELECT count(*)=0 FROM public.user_product_access,p WHERE product_id=p.id)`, 'buyer access ends with the product')}
    SELECT 'contract passed';`)).toContain('contract passed');
});

it('remove_product_as archives a sold product, restores it, and deletes it permanently only from the archive @J602', () => {
  expect(sql(`${soldProduct}
    ${assert(`(SELECT impact->>'orders'='1' AND impact->>'invoices'='1' AND impact->>'licenses'='1' AND impact->>'accesses'='1'
      AND (impact->>'hasHistory')::boolean FROM (SELECT public.product_deletion_impact(id) AS impact FROM p) i)`, 'impact lists every kept record')}
    SAVEPOINT direct;
    DO $$ BEGIN
      PERFORM public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', (SELECT id FROM p), (SELECT admin FROM p), true);
      RAISE EXCEPTION 'permanent delete of a sold, not archived product must be refused';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END $$;
    ROLLBACK TO direct;
    ${assert(`(SELECT r->>'result'='archived' FROM (SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, false) AS r FROM p) x)`, 'sold product is archived')}
    ${assert(`(SELECT archived_at IS NOT NULL AND NOT is_active FROM public.products,p WHERE products.id=p.id)`, 'archived product is not sold')}
    ${assert(`(SELECT count(*)=1 FROM public.payment_transactions,p WHERE product_id=p.id)`, 'archive keeps the order linked')}
    ${assert(`(SELECT count(*)=1 FROM public.user_product_access,p WHERE product_id=p.id)`, 'archive keeps buyer access')}
    ${assert(`${productEvents('product.updated')}=2`, 'archive emits one product.updated')}
    ${assert(`(SELECT payload->'product'->>'archivedAt' IS NOT NULL AND payload->'product'->>'isActive'='false'
      AND payload->'changedFields' ? 'archivedAt' FROM public.business_events,p WHERE business_events.product_id=p.id
      AND event_type='product.updated' ORDER BY created_at DESC, (payload->>'revision')::int DESC LIMIT 1)`, 'archive event carries the archive state')}
    ${assert(`(SELECT r->>'result'='archived' FROM (SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, false) AS r FROM p) x)`, 'repeated delete stays archived')}
    ${assert(`${productEvents('product.updated')}=2`, 'repeated delete emits nothing')}
    SAVEPOINT activate;
    DO $$ BEGIN
      UPDATE public.products SET is_active=true WHERE id=(SELECT id FROM p);
      RAISE EXCEPTION 'an archived product must not be activated';
    EXCEPTION WHEN check_violation THEN NULL; END $$;
    ROLLBACK TO activate;
    ${assert(`(SELECT r->>'result'='restored' FROM (SELECT public.restore_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin) AS r FROM p) x)`, 'archived product is restored')}
    ${assert(`(SELECT archived_at IS NULL AND NOT is_active FROM public.products,p WHERE products.id=p.id)`, 'restored product stays inactive until the seller activates it')}
    ${assert(`${productEvents('product.updated')}=3`, 'restore emits one product.updated')}
    SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, false) FROM p;
    CREATE TEMP TABLE before_delete AS SELECT count(*) AS n FROM public.business_events,p WHERE business_events.product_id=p.id AND event_type LIKE 'product.%';
    ${assert(`(SELECT r->>'result'='deleted' FROM (SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, true) AS r FROM p) x)`, 'archived product is deleted permanently')}
    ${assert(`${productEvents('product.deleted')}=1`, 'permanent delete emits exactly one product.deleted')}
    ${assert(`(SELECT count(*) FROM public.business_events,p WHERE business_events.product_id=p.id AND event_type LIKE 'product.%')=(SELECT n+1 FROM before_delete)`, 'permanent delete emits no other product event')}
    ${assert(`(SELECT count(*)=0 FROM public.products,p WHERE products.id=p.id)`, 'product row is gone')}
    ${assert(`(SELECT product_name='Archive course' FROM public.payment_transactions,p WHERE payment_transactions.id=p.tx)`, 'order survives permanent delete')}
    ${assert(`(SELECT count(*)=1 FROM public.issued_licenses,p WHERE order_id=p.tx::text)`, 'license survives permanent delete')}
    SELECT 'contract passed';`)).toContain('contract passed');
});

it('remove_product_as deletes a product without history at once and is service-role only', () => {
  expect(sql(`
    CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id, (SELECT user_id FROM public.admin_users LIMIT 1) AS admin;
    INSERT INTO public.products(id,name,slug,price,currency) SELECT id,'Never sold','w250-'||id,9,'PLN' FROM p;
    ${assert(`(SELECT r->>'result'='deleted' FROM (SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, false) AS r FROM p) x)`, 'unsold product is deleted')}
    ${assert(`${productEvents('product.deleted')}=1`, 'one product.deleted')}
    ${assert(`NOT has_function_privilege('authenticated','public.remove_product_as(jsonb,uuid,uuid,boolean)','EXECUTE')
      AND NOT has_function_privilege('anon','public.restore_product_as(jsonb,uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.product_deletion_impact(uuid)','EXECUTE')`, 'functions are service-role only')}
    SELECT 'contract passed';`)).toContain('contract passed');
});
