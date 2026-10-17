\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
CREATE TEMP TABLE a_fixture AS SELECT jsonb_set(jsonb_set(published, '{templateId}', '"storefront-a"'), '{content}',
  '{"home.catalogue":{"sourceLocale":"en","en":{"kind":"heading","heading":"Find your next project","body":"Choose a guide or toolkit."}}}') AS config
FROM public.storefront_config;
UPDATE a_fixture SET config = jsonb_set(config, '{content,home.comparison}', jsonb_build_object('sourceLocale','en','en',jsonb_build_object(
  'kind','comparison','heading','Two ways to start','body','Two separate products.',
  'items',(SELECT jsonb_agg(jsonb_build_object('productId',id,'eyebrow','Example','heading','A starting point','body','Review the product requirements.','bullets','[]'::jsonb))
    FROM jsonb_array_elements_text(config#>'{settingsByTemplate,storefront-a,comparisonProducts}') id))));
SELECT pg_temp.assert_true(public.storefront_config_valid(config), 'A stored schema accepts retained bindings and copy') FROM a_fixture;
SELECT pg_temp.assert_true(public.storefront_config_valid(jsonb_set(config, '{overridesByTemplate,storefront-a}',
  '{"order":["hero"],"sections":{"tasks":{"visibility":"hidden"},"start":{"variant":"compact"}}}')), 'A section intent and subset accepted') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config, '{overridesByTemplate,storefront-a}', '{"hidden":[]}')), 'A old visibility shape rejected') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config, '{overridesByTemplate,storefront-a}', '{"sections":{"catalogue":{"visibility":"hidden"}}}')), 'A catalogue stays visible') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config, '{overridesByTemplate,storefront-a}', '{"sections":{"comparison":{"variant":"featured-grid"}}}')), 'A variants follow descriptors') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(config || '{"extra":true}'), 'unknown config field rejected') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config, '{templateId}', '"storefront-unknown"')), 'unregistered template rejected') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config, '{settingsByTemplate,storefront-a,comparisonProducts}', '[]')), 'comparison requires two bindings') FROM a_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config, '{content,home.comparison,en,items,1,productId}', config#>'{content,home.comparison,en,items,0,productId}')), 'comparison copy uses distinct products') FROM a_fixture;
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.storefront_config','SELECT'), 'anonymous config read unavailable');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.storefront_config','UPDATE'), 'member direct updates unavailable');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_config_schema()','EXECUTE'), 'schema function remains private');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.storefront_config_schema()','EXECUTE'), 'service schema function available');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.assert_true((public.mutate_storefront_config(0,'draft', config,NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean, 'A draft saved') FROM a_fixture;
SELECT pg_temp.assert_true((public.mutate_storefront_config(1,'draft', jsonb_set(config,'{templateId}','"d"'),NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean, 'D draft retains A settings') FROM a_fixture;
SELECT pg_temp.assert_true((public.mutate_storefront_config(2,'draft', config,NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean, 'A draft restored') FROM a_fixture;
SELECT pg_temp.assert_true((SELECT draft = config FROM public.storefront_config), 'stored A copy and bindings round-trip') FROM a_fixture;
SELECT pg_temp.assert_true((SELECT published->>'templateId' = 'default' AND revision = 3 FROM public.storefront_config), 'draft switching preserves public selection');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.storefront_config_history WHERE revision BETWEEN 1 AND 3), 'switches retain revision history');
ROLLBACK;
