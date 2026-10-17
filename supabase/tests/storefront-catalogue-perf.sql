\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_catalogue_boundary()','EXECUTE'), 'boundary is service-only');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.storefront_catalogue_boundary()','EXECUTE'), 'boundary excludes sessions');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.storefront_catalogue_boundary()','EXECUTE'), 'boundary service grant');
-- Isolate fixture scheduling from the existing seed.
UPDATE public.products SET available_from=null,available_until=null,sale_price_until=null WHERE available_from IS NOT NULL OR available_until IS NOT NULL OR sale_price_until IS NOT NULL;
INSERT INTO public.products(name,slug,price,currency,is_active,is_listed,available_from,available_until,sale_price_until) VALUES
 ('Perf future arrival','perf-boundary-arrival',10,'USD',true,true,statement_timestamp()+interval '10 seconds',null,null),
 ('Perf future end','perf-boundary-end',10,'USD',true,true,null,statement_timestamp()+interval '20 seconds',null),
 ('Perf future sale','perf-boundary-sale',10,'USD',true,true,null,null,statement_timestamp()+interval '30 seconds'),
 ('Perf hidden arrival','perf-boundary-hidden',10,'USD',true,false,statement_timestamp()+interval '1 second',null,null),
 ('Perf inactive arrival','perf-boundary-inactive',10,'USD',false,true,statement_timestamp()+interval '1 second',null,null);
SELECT pg_temp.assert_true((SELECT public.storefront_catalogue_boundary()=available_from FROM public.products WHERE slug='perf-boundary-arrival'), 'next arrival includes absent products and ignores hidden products');
UPDATE public.products SET available_from=statement_timestamp()-interval '1 second' WHERE slug='perf-boundary-arrival';
SELECT pg_temp.assert_true((SELECT public.storefront_catalogue_boundary()=available_until FROM public.products WHERE slug='perf-boundary-end'), 'expired boundaries ignored; next end exact');
UPDATE public.products SET available_until=null WHERE slug='perf-boundary-end';
SELECT pg_temp.assert_true((SELECT public.storefront_catalogue_boundary()=sale_price_until FROM public.products WHERE slug='perf-boundary-sale'), 'next sale expiry exact');
UPDATE public.products SET sale_price_until=null WHERE slug='perf-boundary-sale';
SELECT pg_temp.assert_true(public.storefront_catalogue_boundary() IS NULL, 'no future boundary');
UPDATE public.products SET name='Żółć 100%_Ready\path' WHERE slug='perf-boundary-arrival';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.storefront_catalogue_page('{"search":"ŻÓŁĆ 100%_ready\\path"}')), 'ILIKE preserves literal percent underscore backslash and case');
SELECT pg_temp.assert_true((SELECT count(*)=7 FROM pg_indexes WHERE schemaname='public' AND indexname IN ('storefront_products_featured','storefront_products_free','storefront_products_paid','storefront_products_name_trgm','storefront_products_available_from','storefront_products_available_until','storefront_products_sale_until')), 'group search and boundary indexes present');
INSERT INTO public.categories(id,name,slug) VALUES
 ('92000000-0000-4000-8000-000000000001','Available products','perf-category-available'),
 ('92000000-0000-4000-8000-000000000002','Empty category','perf-category-empty');
INSERT INTO public.product_categories(product_id,category_id)
SELECT id,'92000000-0000-4000-8000-000000000001' FROM public.products WHERE slug IN ('perf-boundary-hidden','perf-boundary-inactive');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.storefront_catalogue_categories(ARRAY['92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002']::uuid[])), 'categories omit empty and ineligible products');
INSERT INTO public.product_categories(product_id,category_id)
SELECT id,'92000000-0000-4000-8000-000000000001' FROM public.products WHERE slug='perf-boundary-arrival';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(name)='Available products' FROM public.storefront_catalogue_categories(ARRAY['92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002']::uuid[])), 'category lookup finds an eligible product after ineligible links');
RESET ROLE;
UPDATE public.products SET available_until=statement_timestamp()-interval '1 second' WHERE slug='perf-boundary-arrival';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.storefront_catalogue_categories(ARRAY['92000000-0000-4000-8000-000000000001']::uuid[])), 'category lookup observes availability expiry');
ROLLBACK;
