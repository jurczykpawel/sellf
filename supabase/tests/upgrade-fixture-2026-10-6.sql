\set ON_ERROR_STOP on
-- Fixed historical shop data for the populated release upgrade gate.
-- @see admin-panel/scripts/upgrade-data-test.sh
BEGIN;
CREATE FUNCTION pg_temp.upgrade_id(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT overlay(overlay(md5(label) placing '4' from 13) placing '8' from 17)::uuid;
$$;
INSERT INTO auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('a1100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','upgrade-member@example.com','2026-10-01Z','{"provider":"email","providers":["email"]}','{}','2026-10-01Z','2026-10-01Z');
INSERT INTO public.products(id,name,slug,description,price,currency,vat_rate,price_includes_vat,vat_exempt) VALUES
(pg_temp.upgrade_id('upgrade-gross'),'Upgrade Gross','upgrade-gross','Historical gross course',123,'PLN',0.23,true,false),
(pg_temp.upgrade_id('upgrade-net'),'Upgrade Net','upgrade-net','Historical net course',100,'PLN',23,false,false),
(pg_temp.upgrade_id('upgrade-exempt'),'Upgrade Exempt','upgrade-exempt','Exempt book',49,'PLN',NULL,true,true),
(pg_temp.upgrade_id('upgrade-free'),'Upgrade Free','upgrade-free','Free guide',0,'PLN',0,true,false),
(pg_temp.upgrade_id('upgrade-pwyw'),'Upgrade PWYW','upgrade-pwyw','Support',10,'PLN',23,true,false),
(pg_temp.upgrade_id('upgrade-jpy'),'Upgrade JPY','upgrade-jpy','JPY guide',1500,'JPY',0,true,false),
(pg_temp.upgrade_id('upgrade-subscription'),'Upgrade Subscription','upgrade-subscription','Monthly course',0,'PLN',0.23,false,false),
(pg_temp.upgrade_id('upgrade-bundle'),'Upgrade Bundle','upgrade-bundle','Two courses',149,'PLN',23,true,false),
(pg_temp.upgrade_id('upgrade-bump'),'Upgrade Bump','upgrade-bump','Workbook',25,'PLN',23,true,false),
(pg_temp.upgrade_id('upgrade-oto'),'Upgrade OTO','upgrade-oto','Follow-up course',99,'PLN',23,true,false),
(pg_temp.upgrade_id('upgrade-sale'),'Upgrade Sale','upgrade-sale','Limited sale',200,'PLN',23,true,false);
UPDATE public.products SET allow_custom_price=true,custom_price_min=5 WHERE slug='upgrade-pwyw';
UPDATE public.products SET product_type='subscription',recurring_price=29,billing_interval='month',billing_interval_count=1 WHERE slug='upgrade-subscription';
UPDATE public.products SET is_bundle=true WHERE slug='upgrade-bundle';
UPDATE public.products SET sale_price=150,sale_price_until='2099-12-31Z',sale_quantity_limit=10,sale_quantity_sold=2 WHERE slug='upgrade-sale';
INSERT INTO public.bundle_items(bundle_product_id,component_product_id,display_order) VALUES
(pg_temp.upgrade_id('upgrade-bundle'),pg_temp.upgrade_id('upgrade-gross'),0),
(pg_temp.upgrade_id('upgrade-bundle'),pg_temp.upgrade_id('upgrade-net'),1);
INSERT INTO public.order_bumps(id,main_product_id,bump_product_id,bump_price,bump_title)
VALUES (pg_temp.upgrade_id('upgrade-bump-link'),pg_temp.upgrade_id('upgrade-gross'),pg_temp.upgrade_id('upgrade-bump'),20,'Add workbook');
INSERT INTO public.oto_offers(source_product_id,oto_product_id,discount_type,discount_value)
VALUES (pg_temp.upgrade_id('upgrade-gross'),pg_temp.upgrade_id('upgrade-oto'),'percentage',20);
INSERT INTO public.variant_groups(id,name,slug) VALUES (pg_temp.upgrade_id('upgrade-variants'),'Upgrade variants','upgrade-variants');
INSERT INTO public.product_variant_groups(product_id,group_id,variant_name,display_order) VALUES
(pg_temp.upgrade_id('upgrade-gross'),pg_temp.upgrade_id('upgrade-variants'),'Gross',0),
(pg_temp.upgrade_id('upgrade-net'),pg_temp.upgrade_id('upgrade-variants'),'Net',1);
INSERT INTO public.coupons(id,code,name,discount_type,discount_value,currency,current_usage_count,starts_at) VALUES
(pg_temp.upgrade_id('upgrade-percent'),'UPGRADE10','Historical percentage','percentage',10,NULL,1,'2026-10-01Z'),
(pg_temp.upgrade_id('upgrade-fixed'),'UPGRADE20','Historical fixed','fixed',20,'PLN',1,'2026-10-01Z');
INSERT INTO public.stripe_customers(user_id,stripe_customer_id)
VALUES ('a1100000-0000-4000-8000-000000000001','cus_upgrade_member');
INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,status,current_period_start,current_period_end)
VALUES (pg_temp.upgrade_id('upgrade-subscription-record'),'a1100000-0000-4000-8000-000000000001',pg_temp.upgrade_id('upgrade-subscription'),'cus_upgrade_member','sub_upgrade_member','price_upgrade_month','active','2026-10-01Z','2099-12-31Z');
INSERT INTO public.payment_transactions(id,session_id,product_id,user_id,customer_email,amount,currency,status,refunded_amount,created_at)
SELECT pg_temp.upgrade_id('upgrade-tx-' || n),'cs_upgrade_' || n,pg_temp.upgrade_id('upgrade-gross'),
 CASE WHEN n IN (2,7) THEN 'a1100000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN n IN (2,7) THEN 'upgrade-member@example.com' ELSE 'upgrade-guest-' || n || '@example.com' END,
 CASE n WHEN 1 THEN 14300 WHEN 2 THEN 11070 WHEN 3 THEN 10300 ELSE 12300 END,
 'PLN',CASE n WHEN 4 THEN 'refunded' WHEN 6 THEN 'abandoned' WHEN 7 THEN 'pending' ELSE 'completed' END,
 CASE WHEN n=4 THEN 12300 ELSE 0 END,'2026-10-02Z'::timestamptz + n * interval '1 minute'
FROM generate_series(1,7) n;
UPDATE public.payment_transactions SET refunded_at='2026-10-03Z',refund_id='re_upgrade_refund',refund_reason='Requested refund' WHERE session_id='cs_upgrade_4';
INSERT INTO public.payment_transactions(id,session_id,product_id,user_id,customer_email,amount,currency,status,subscription_id,stripe_invoice_id,created_at) VALUES
(pg_temp.upgrade_id('upgrade-invoice'),'pi_upgrade_invoice',pg_temp.upgrade_id('upgrade-subscription'),'a1100000-0000-4000-8000-000000000001','upgrade-member@example.com',2900,'PLN','completed',pg_temp.upgrade_id('upgrade-subscription-record'),'in_upgrade_first','2026-10-02Z'),
(pg_temp.upgrade_id('upgrade-jpy-tx'),'cs_upgrade_jpy',pg_temp.upgrade_id('upgrade-jpy'),NULL,'upgrade-jpy@example.com',1500,'JPY','completed',NULL,NULL,'2026-10-02Z'),
(pg_temp.upgrade_id('upgrade-pwyw-tx'),'cs_upgrade_pwyw',pg_temp.upgrade_id('upgrade-pwyw'),NULL,'upgrade-pwyw@example.com',2500,'PLN','completed',NULL,NULL,'2026-10-02Z');
INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency) VALUES
(pg_temp.upgrade_id('upgrade-invoice'),pg_temp.upgrade_id('upgrade-subscription'),'main_product',1,29,29,'PLN'),
(pg_temp.upgrade_id('upgrade-jpy-tx'),pg_temp.upgrade_id('upgrade-jpy'),'main_product',1,1500,1500,'JPY'),
(pg_temp.upgrade_id('upgrade-pwyw-tx'),pg_temp.upgrade_id('upgrade-pwyw'),'main_product',1,25,25,'PLN');
INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency)
SELECT id,product_id,'main_product',1,123,123,'PLN' FROM public.payment_transactions WHERE session_id ~ '^cs_upgrade_[0-9]+$' AND status NOT IN ('pending','abandoned');
INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,order_bump_id,quantity,unit_price,total_price,currency)
VALUES(pg_temp.upgrade_id('upgrade-tx-1'),pg_temp.upgrade_id('upgrade-bump'),'order_bump',pg_temp.upgrade_id('upgrade-bump-link'),1,20,20,'PLN');
INSERT INTO public.coupon_redemptions(coupon_id,user_id,customer_email,transaction_id,discount_amount) VALUES
(pg_temp.upgrade_id('upgrade-percent'),'a1100000-0000-4000-8000-000000000001','upgrade-member@example.com',pg_temp.upgrade_id('upgrade-tx-2'),12.3),
(pg_temp.upgrade_id('upgrade-fixed'),NULL,'upgrade-guest-3@example.com',pg_temp.upgrade_id('upgrade-tx-3'),20);
INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,session_id)
SELECT customer_email,product_id,amount,session_id FROM public.payment_transactions WHERE session_id IN ('cs_upgrade_1','cs_upgrade_3','cs_upgrade_5');
INSERT INTO public.user_product_access(user_id,product_id)
VALUES ('a1100000-0000-4000-8000-000000000001',pg_temp.upgrade_id('upgrade-exempt'));
INSERT INTO public.webhook_endpoints(id,url,events,description)
VALUES (pg_temp.upgrade_id('upgrade-webhook'),'https://example.com/upgrade-webhook',ARRAY['purchase.completed'],'Historical endpoint');
INSERT INTO public.webhook_logs(endpoint_id,event_type,payload,status,http_status)
VALUES (pg_temp.upgrade_id('upgrade-webhook'),'purchase.completed','{"session_id":"cs_upgrade_1"}','success',200);
COMMIT;
