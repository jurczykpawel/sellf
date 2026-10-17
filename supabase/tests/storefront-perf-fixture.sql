\set ON_ERROR_STOP on
-- Disposable sellf-perf only; the runner verifies the API/container pair first.
BEGIN;
TRUNCATE public.products CASCADE;
-- Batch the initial history instead of invoking its cleanup for each product.
ALTER TABLE public.products DISABLE TRIGGER product_price_change_trigger;
INSERT INTO public.products(id,name,slug,description,price,currency,is_active,is_listed,is_featured,created_at,marketing_fields)
SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'Performance course '||n,'perf-course-'||n,'Build and review an automated report using a synthetic practice dataset.',
 CASE WHEN n%11=0 THEN 0 ELSE 49 END,'USD',true,true,n%97=0,
 '2026-01-01 00:00:00.123456+00'::timestamptz-(n%3)*interval '1 microsecond',
 jsonb_build_object('format','course','sourceLocale','en','en',jsonb_build_object('result','Build a repeatable report','tools','["Spreadsheet"]'::jsonb,'requirements','["Basic spreadsheet knowledge"]'::jsonb))
FROM generate_series(1,:size) n;
UPDATE public.products SET name='RareNeedle Performance course' WHERE slug='perf-course-777';
INSERT INTO public.product_price_history(product_id,price,currency,vat_rate,price_includes_vat)
SELECT id,price,currency,vat_rate,price_includes_vat FROM public.products;
ALTER TABLE public.products ENABLE TRIGGER product_price_change_trigger;
INSERT INTO public.categories(id,name,slug) VALUES ('20000000-0000-4000-8000-000000000001','Reporting','perf-reporting') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.product_categories(product_id,category_id) SELECT id,'20000000-0000-4000-8000-000000000001' FROM public.products;
ANALYZE public.products;
ANALYZE public.product_categories;
ANALYZE public.product_price_history;
SELECT count(*) FROM public.products;
COMMIT;
