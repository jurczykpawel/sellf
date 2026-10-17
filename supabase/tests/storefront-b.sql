\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE TEMP TABLE b_fixture AS SELECT jsonb_set(published, '{templateId}', '"storefront-b"') config FROM public.storefront_config;
UPDATE b_fixture SET config=jsonb_set(config,'{content}', '{"home.search":{"sourceLocale":"en","en":{"kind":"search","heading":"Find a task","body":"Browse guides.","items":[{"id":"reports","categoryId":"55555555-5555-4555-8555-555555555555","description":"Build a report."}]}},"home.featured":{"sourceLocale":"en","en":{"kind":"heading","heading":"Featured","body":"Choose a guide.","items":[{"productId":"11111111-1111-4111-8111-111111111111","descriptor":"Guide"}]}},"home.starter":{"sourceLocale":"pl","pl":{"kind":"cta","heading":"Zacznij tutaj","body":"Poznaj materiał."}}}');
SELECT pg_temp.assert_true(public.storefront_config_valid(config),'B stored bindings and localized slots accepted') FROM b_fixture;
SELECT pg_temp.assert_true(public.storefront_config_valid(jsonb_set(config,'{overridesByTemplate,storefront-b}','{"order":["hero"],"sections":{"featured":{"visibility":"hidden"},"starter":{"visibility":"hidden"}}}')),'B subset and optional visibility accepted') FROM b_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{overridesByTemplate,storefront-b}','{"sections":{"catalogue":{"visibility":"hidden"}}}')),'B catalogue remains visible') FROM b_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{overridesByTemplate,storefront-b}','{"sections":{"hero":{"variant":"offer-focus"}}}')),'B variants follow descriptors') FROM b_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{settingsByTemplate,storefront-b,featuredProducts}',(SELECT jsonb_agg(id) FROM generate_series(1,7) n CROSS JOIN LATERAL (SELECT '11111111-1111-4111-8111-111111111111'::text id) p))),'B seven bindings rejected') FROM b_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{settingsByTemplate,storefront-b,featuredProducts}','["11111111-1111-4111-8111-111111111111","11111111-1111-4111-8111-111111111111"]')),'B duplicate bindings rejected') FROM b_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.featured,en,items}',(config#>'{content,home.featured,en,items}') || (config#>'{content,home.featured,en,items}'))),'B duplicate product copy rejected') FROM b_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.search,en,items}',(config#>'{content,home.search,en,items}') || '[{"id":"other","categoryId":"55555555-5555-4555-8555-555555555555","description":"Other"}]')),'B duplicate categories rejected') FROM b_fixture;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_config_schema()','EXECUTE'),'schema remains private');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.storefront_config','UPDATE'),'members cannot write directly');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.assert_true((public.mutate_storefront_config(0,'draft',config,NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean,'B draft saved') FROM b_fixture;
SELECT pg_temp.assert_true((public.mutate_storefront_config(1,'draft',jsonb_set(config,'{templateId}','"d"'),NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean,'D retains B settings') FROM b_fixture;
SELECT pg_temp.assert_true((public.mutate_storefront_config(2,'draft',config,NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean,'B restored') FROM b_fixture;
SELECT pg_temp.assert_true((SELECT draft=config FROM public.storefront_config),'B round-trip exact') FROM b_fixture;
ROLLBACK;
