\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
 RAISE NOTICE 'PASS: %', label;
END; $$;
SELECT pg_temp.assert_true(to_regprocedure('public.storefront_catalogue_page(jsonb,timestamp with time zone,uuid,uuid[])') IS NOT NULL, 'catalogue function exists');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_catalogue_page(jsonb,timestamp with time zone,uuid,uuid[])','EXECUTE'), 'private read primitive');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.storefront_catalogue_categories(uuid[])','EXECUTE'), 'private taxonomy primitive');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.storefront_catalogue_page(jsonb,timestamp with time zone,uuid,uuid[])','EXECUTE'), 'service read primitive');
-- Bulk fixtures retain price recording; defer statement housekeeping until the fixture is loaded.
ALTER TABLE public.product_price_history DISABLE TRIGGER cleanup_price_history_trigger;
-- Batch initial history; fixture ingestion is outside the measured traversal.
ALTER TABLE public.products DISABLE TRIGGER product_price_change_trigger;
INSERT INTO public.products(id, name, slug, price, currency, is_listed, is_active, created_at, is_featured, marketing_fields)
SELECT ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'Catalogue fixture ' || n, 'catalogue-fixture-' || n, CASE WHEN n%3=0 THEN 0 ELSE 10 END, 'USD', true, true,
 '2026-01-01 00:00:00.123456+00'::timestamptz - (n%3)*interval '1 microsecond', n%5=0,
 jsonb_build_object('format',CASE WHEN n%2=0 THEN 'course' ELSE 'ebook' END,'sourceLocale','en','en',jsonb_build_object('result',null,'tools','[]'::jsonb,'requirements','[]'::jsonb))
FROM generate_series(1,100000) n;
ALTER TABLE public.products ENABLE TRIGGER product_price_change_trigger;
INSERT INTO public.product_price_history(product_id,price,sale_price,currency,vat_rate,price_includes_vat)
SELECT id,price,sale_price,currency,vat_rate,price_includes_vat FROM public.products WHERE slug LIKE 'catalogue-fixture-%';
INSERT INTO public.categories(id,name,slug) VALUES ('20000000-0000-4000-8000-000000000001','Catalogue A','catalogue-a'),('20000000-0000-4000-8000-000000000002','Catalogue B','catalogue-b'),('20000000-0000-4000-8000-000000000003','Empty','catalogue-empty'),('20000000-0000-4000-8000-000000000004','Small catalogue','catalogue-small');
INSERT INTO public.product_categories(product_id,category_id)
SELECT id,'20000000-0000-4000-8000-000000000001' FROM public.products WHERE slug LIKE 'catalogue-fixture-%';
INSERT INTO public.product_categories(product_id,category_id)
SELECT id,'20000000-0000-4000-8000-000000000002' FROM public.products WHERE slug LIKE 'catalogue-fixture-%' AND marketing_fields->>'format'='course';
INSERT INTO public.product_categories(product_id,category_id)
SELECT id,'20000000-0000-4000-8000-000000000004' FROM public.products
WHERE slug LIKE 'catalogue-fixture-%' AND right(id::text,12)::bigint<=1000;
ALTER TABLE public.product_price_history ENABLE TRIGGER cleanup_price_history_trigger;
ANALYZE public.products;
ANALYZE public.product_categories;
CREATE TEMP TABLE reached(id uuid PRIMARY KEY);
DO $$
DECLARE size integer; filters jsonb; batch jsonb[]; item jsonb; stamp timestamptz; last_id uuid; pages integer; start_at timestamptz;
BEGIN
 FOREACH size IN ARRAY ARRAY[1000,100000] LOOP
  filters := '{"locale":"en","search":"Catalogue fixture","categoryIds":[],"priceKind":null,"format":null,"group":"all","pageSize":24}';
  IF size=1000 THEN filters:=filters || '{"categoryIds":["20000000-0000-4000-8000-000000000004"]}'::jsonb; END IF;
  TRUNCATE reached; stamp:=null; last_id:=null; pages:=0; start_at:=clock_timestamp();
  LOOP
   SELECT array_agg(value) INTO batch FROM public.storefront_catalogue_page(filters,stamp,last_id,null) value;
   EXIT WHEN coalesce(cardinality(batch),0)=0;
   PERFORM pg_temp.assert_true(cardinality(batch)<=25,'bounded batch') WHERE pages=0;
   FOR i IN 1..least(24,cardinality(batch)) LOOP
    item:=batch[i]; INSERT INTO reached VALUES ((item->>'id')::uuid);
   END LOOP;
   pages:=pages+1; stamp:=(item->>'created_at')::timestamptz; last_id:=(item->>'id')::uuid;
   EXIT WHEN cardinality(batch)<=24;
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT count(*)=size FROM reached),'all '||size||' matching products reached exactly once');
  RAISE NOTICE 'MEASURED: % rows, % pages, % ms',size,pages,extract(epoch FROM clock_timestamp()-start_at)*1000;
 END LOOP;
END; $$;
UPDATE public.products SET name='Żółć 100%_Ready' WHERE slug='catalogue-fixture-1';
UPDATE public.products SET name='Żółć 100XXReady' WHERE slug='catalogue-fixture-2';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.storefront_catalogue_page('{"search":"ŻÓŁĆ 100%_ready","pageSize":24}',null,null,null)), 'case/non-ASCII and literal percent/underscore');
SELECT pg_temp.assert_true((SELECT count(*)=25 AND bool_and(value->'marketing_fields'->>'format'='course') FROM public.storefront_catalogue_page('{"categoryIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002"],"format":"course","pageSize":24}',null,null,null) value), 'category intersection and format before limit');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.storefront_catalogue_page('{"categoryIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000003"],"pageSize":24}',null,null,null)), 'every requested category must match');
UPDATE public.products SET available_from=now()+interval '1 day' WHERE slug='catalogue-fixture-1';
UPDATE public.products SET available_until=now()-interval '1 day' WHERE slug='catalogue-fixture-2';
UPDATE public.products SET is_active=false WHERE slug='catalogue-fixture-3';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.storefront_catalogue_page('{"pageSize":24}',null,null,ARRAY['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003']::uuid[])), 'bindings omit unavailable/inactive');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.storefront_catalogue_categories(ARRAY['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003']::uuid[])), 'empty categories omitted');
SELECT pg_temp.assert_true((SELECT bool_and(NOT(value ?| ARRAY['content_config','seller_id','stripe_price_id','license_tier','customer_email'])) FROM public.storefront_catalogue_page('{"pageSize":24}',null,null,null) value), 'explicit public row projection');
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM public.products
WHERE is_active AND is_listed AND marketing_fields->>'format'='course'
ORDER BY created_at DESC,id ASC LIMIT 25;
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.storefront_catalogue_page('{"format":"course","pageSize":24}',null,null,null);
ROLLBACK;

-- Core states and read roles, independent of the large fixture above.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE FUNCTION pg_temp.invalid_page(filters jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN PERFORM public.storefront_catalogue_page(filters,null,null,null); RETURN false;
EXCEPTION WHEN invalid_parameter_value THEN RETURN true; END; $$;
INSERT INTO public.products(name,slug,price,currency,product_type,recurring_price,billing_interval,billing_interval_count,allow_custom_price,is_featured) VALUES
 ('Core catalogue free','core-catalogue-free',0,'USD','one_time',null,null,null,false,true),
 ('Core catalogue zero subscription','core-catalogue-sub',0,'USD','subscription',0,'month',1,false,true),
 ('Core catalogue pwyw','core-catalogue-pwyw',0,'USD','one_time',null,null,null,true,false),
 ('Core catalogue paid','core-catalogue-paid',10,'USD','one_time',null,null,null,false,false);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(value->>'slug'='core-catalogue-free') FROM public.storefront_catalogue_page('{"search":"Core catalogue","group":"free"}',null,null,null) value), 'free excludes zero subscription and PWYW');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.storefront_catalogue_page('{"search":"Core catalogue","group":"paid"}',null,null,null)), 'paid includes subscription and PWYW');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.storefront_catalogue_page('{"search":"Core catalogue","group":"featured"}',null,null,null)), 'featured independently overlaps free and paid');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.storefront_catalogue_page('{"search":"Core catalogue","priceKind":"subscription"}',null,null,null)), 'core kind filter');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.storefront_catalogue_page('{"search":"Core catalogue","group":"free","priceKind":"subscription"}',null,null,null)), 'all predicates intersect');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.storefront_catalogue_page('{"search":"Core catalogue"}','1900-01-01',gen_random_uuid(),null)), 'empty final page');
SELECT pg_temp.assert_true(pg_temp.invalid_page('{"pageSize":25}'),'page size validated');
SELECT pg_temp.assert_true(pg_temp.invalid_page('{"search":"x","categoryIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001"]}'),'duplicate categories rejected');
RESET ROLE;
UPDATE public.shop_config SET omnibus_enabled=true;
DELETE FROM public.product_price_history WHERE product_id=(SELECT id FROM public.products WHERE slug='core-catalogue-paid');
INSERT INTO public.product_price_history(product_id,price,sale_price,currency,effective_from)
SELECT id,20,15,'USD',now()-interval '2 days' FROM public.products WHERE slug='core-catalogue-paid'
UNION ALL SELECT id,18,10,'USD',now()-interval '1 day' FROM public.products WHERE slug='core-catalogue-paid';
SELECT pg_temp.assert_true((SELECT (value->>'lowest_prior_price')::numeric=15 FROM public.storefront_catalogue_page('{"search":"Core catalogue paid"}',null,null,null) value), 'batched prior price excludes current reduction');
UPDATE public.products SET omnibus_exempt=true WHERE slug='core-catalogue-paid';
SELECT pg_temp.assert_true((SELECT value->'lowest_prior_price'='null'::jsonb FROM public.storefront_catalogue_page('{"search":"Core catalogue paid"}',null,null,null) value), 'prior price exemption');
ROLLBACK;
