\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
INSERT INTO public.products(name,slug,description,price,currency,is_active,is_listed,auto_grant_duration_days,available_until)
VALUES ('Buyer facts SQL fixture','buyer-facts-sql-fixture',repeat('ą😀',180),20,'USD',true,true,30,now()+interval '1 day');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT value->>'description'=left(repeat('ą😀',180),280)
  AND char_length(value->>'description')=280
  AND (value->>'auto_grant_duration_days')::integer=30
  AND (value->>'available_until')::timestamptz=now()+interval '1 day'
  FROM public.storefront_catalogue_page('{"search":"Buyer facts SQL fixture","pageSize":12}',null,null,null) value),
  'bounded description, finite access and availability are public buyer facts');
SELECT pg_temp.assert_true((SELECT NOT(value ?| ARRAY['content_config','seller_id','stripe_price_id','customer_email'])
  FROM public.storefront_catalogue_page('{"search":"Buyer facts SQL fixture","pageSize":12}',null,null,null) value),
  'buyer facts do not add unrelated product fields');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_catalogue_page(jsonb,timestamptz,uuid,uuid[])','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.storefront_catalogue_page(jsonb,timestamptz,uuid,uuid[])','EXECUTE'),
  'catalogue reads retain the service-only boundary');
ROLLBACK;
