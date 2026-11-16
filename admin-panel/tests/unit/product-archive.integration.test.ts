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
  INSERT INTO public.products(id,name,slug,price,currency) SELECT id,'Archive course','archive-'||id,49,'PLN' FROM p;
  INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id)
    SELECT tx,id,'archive-buyer@example.com',4900,'PLN','completed','cs_archive_'||replace(tx::text,'-','') FROM p;
  INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,unit_price,total_price,currency,product_name)
    SELECT tx,id,'main_product',4900,4900,'PLN','Archive course' FROM p;
  INSERT INTO public.invoices(transaction_id,provider,external_key,provider_domain)
    SELECT tx,'fakturownia','archive-'||tx,'archive.example.com' FROM p;
  INSERT INTO public.refund_requests(transaction_id,customer_email,product_id,requested_amount,currency)
    SELECT tx,'archive-buyer@example.com',id,4900,'PLN' FROM p;
  INSERT INTO public.issued_licenses(seller_id,original_seller_id,product_id,email,order_id,kid,license_key)
    SELECT admin,admin,id,'archive-buyer@example.com',tx::text,'archive-kid','archive-token-'||tx FROM p;
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
    ${assert(`(SELECT product_id IS NULL AND product_name='Archive course' AND license_key LIKE 'archive-token-%' FROM public.issued_licenses,p WHERE order_id=p.tx::text)`, 'license must survive with purchase-time name')}
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
    INSERT INTO public.products(id,name,slug,price,currency) SELECT id,'Never sold','archive-'||id,9,'PLN' FROM p;
    ${assert(`(SELECT r->>'result'='deleted' FROM (SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, false) AS r FROM p) x)`, 'unsold product is deleted')}
    ${assert(`${productEvents('product.deleted')}=1`, 'one product.deleted')}
    ${assert(`NOT has_function_privilege('authenticated','public.remove_product_as(jsonb,uuid,uuid,boolean)','EXECUTE')
      AND NOT has_function_privilege('anon','public.restore_product_as(jsonb,uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.product_deletion_impact(uuid)','EXECUTE')`, 'functions are service-role only')}
    SELECT 'contract passed';`)).toContain('contract passed');
});

it('an archived product is hidden from the public, waitlist included, and stays visible to its buyers @J603', () => {
  expect(sql(`
    CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id,
      (SELECT u.id FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id=u.id) ORDER BY u.id LIMIT 1) AS buyer,
      (SELECT u.id FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id=u.id) ORDER BY u.id DESC LIMIT 1) AS stranger;
    GRANT SELECT ON p TO anon, authenticated;
    INSERT INTO public.products(id,name,slug,price,currency,is_active,enable_waitlist,archived_at)
      SELECT id,'Archived waitlist','archive-'||id,9,'PLN',false,true,now() FROM p;
    INSERT INTO public.user_product_access(user_id,product_id,grant_source) SELECT buyer,id,'purchase' FROM p;
    SET LOCAL ROLE anon; SET LOCAL request.jwt.claims='{"role":"anon"}';
    ${assert(`(SELECT count(*)=0 FROM public.products,p WHERE products.id=p.id)`, 'anon must not see an archived product')}
    RESET ROLE;
    SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub',stranger)::text, true) FROM p;
    SET LOCAL ROLE authenticated;
    ${assert(`(SELECT count(*)=0 FROM public.products,p WHERE products.id=p.id)`, 'a signed-in non-buyer must not see it')}
    RESET ROLE;
    SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub',buyer)::text, true) FROM p;
    SET LOCAL ROLE authenticated;
    ${assert(`(SELECT count(*)=1 AND bool_and(archived_at IS NOT NULL) FROM public.products,p WHERE products.id=p.id)`, 'the buyer keeps seeing the archived product')}
    RESET ROLE;
    SELECT 'contract passed';`)).toContain('contract passed');
});

it('permanent delete keeps ended subscriptions and past reservations, removes rules and bundle links, and is blocked only by active subscriptions or future reservations @J602', () => {
  expect(sql(`
    CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id, gen_random_uuid() AS bundle, gen_random_uuid() AS past_tx, gen_random_uuid() AS future_tx,
      gen_random_uuid() AS past_session, gen_random_uuid() AS future_session, gen_random_uuid() AS sub,
      (SELECT user_id FROM public.admin_users LIMIT 1) AS admin;
    INSERT INTO public.products(id,name,slug,price,currency,event_mode,is_active) SELECT id,'Event course','archive-'||id,49,'PLN',true,false FROM p;
    INSERT INTO public.products(id,name,slug,price,currency,is_bundle,is_active) SELECT bundle,'Bundle','archive-bundle-'||bundle,99,'PLN',true,false FROM p;
    INSERT INTO public.bundle_items(bundle_product_id,component_product_id) SELECT bundle,id FROM p;
    INSERT INTO public.affiliate_rules(product_id,revision,enabled,percentage_bps) SELECT id,1,true,1000 FROM p;
    INSERT INTO public.product_sessions(id,product_id,starts_at,capacity) SELECT past_session,id,now()-interval '30 days',10 FROM p;
    INSERT INTO public.product_sessions(id,product_id,starts_at,capacity) SELECT future_session,id,now()+interval '30 days',10 FROM p;
    INSERT INTO public.product_price_tiers(id,session_id,price,seats,sort) SELECT past_session,past_session,49,10,0 FROM p;
    INSERT INTO public.product_price_tiers(id,session_id,price,seats,sort) SELECT future_session,future_session,49,10,0 FROM p;
    INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id)
      SELECT past_tx,id,'archive-past@example.com',4900,'PLN','completed','cs_archive_past'||replace(past_tx::text,'-','') FROM p;
    INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id)
      SELECT future_tx,id,'archive-future@example.com',4900,'PLN','completed','cs_archive_future'||replace(future_tx::text,'-','') FROM p;
    INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,confirmed_at) SELECT past_session,past_session,past_tx,1,'confirmed',now() FROM p;
    INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,confirmed_at) SELECT future_session,future_session,future_tx,1,'confirmed',now() FROM p;
    INSERT INTO public.subscriptions(id,product_id,stripe_customer_id,stripe_subscription_id,status) SELECT sub,id,'cus_archive','sub_archive_'||sub,'active' FROM p;
    SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, false) FROM p;
    ${assert(`(SELECT i->>'activeSubscriptions'='1' AND i->>'futureReservations'='1' AND i->>'affiliateRules'='1' AND i->>'bundles'='1'
      FROM (SELECT public.product_deletion_impact(id) AS i FROM p) x)`, 'impact lists blockers, rules and bundles')}
    SAVEPOINT blocked;
    DO $$ BEGIN
      PERFORM public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', (SELECT id FROM p), (SELECT admin FROM p), true);
      RAISE EXCEPTION 'active subscription and future reservation must block';
    EXCEPTION WHEN SQLSTATE '55006' THEN NULL; END $$;
    ROLLBACK TO blocked;
    UPDATE public.subscriptions SET status='canceled' WHERE id=(SELECT sub FROM p);
    SAVEPOINT reservation;
    DO $$ BEGIN
      PERFORM public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', (SELECT id FROM p), (SELECT admin FROM p), true);
      RAISE EXCEPTION 'a future reservation must block';
    EXCEPTION WHEN SQLSTATE '55006' THEN NULL; END $$;
    ROLLBACK TO reservation;
    UPDATE public.seat_reservations SET status='released', released_at=now() WHERE transaction_id=(SELECT future_tx FROM p);
    ${assert(`(SELECT r->>'result'='deleted' FROM (SELECT public.remove_product_as('{"type":"api_key","id":"00000000-0000-4000-8000-000000000250"}', id, admin, true) AS r FROM p) x)`, 'deleted once nothing blocks')}
    ${assert(`(SELECT product_id IS NULL AND product_name='Event course' AND status='canceled' FROM public.subscriptions,p WHERE subscriptions.id=p.sub)`, 'ended subscription kept with name')}
    ${assert(`(SELECT count(*)=2 FROM public.seat_reservations,p WHERE transaction_id IN (p.past_tx,p.future_tx) AND session_id IS NULL)`, 'reservations kept as history')}
    ${assert(`(SELECT count(*)=0 FROM public.affiliate_rules,p WHERE product_id=p.id)`, 'affiliate rule removed')}
    ${assert(`(SELECT count(*)=0 FROM public.bundle_items,p WHERE bundle_product_id=p.bundle)`, 'bundle link removed')}
    SELECT 'contract passed';`)).toContain('contract passed');
});
