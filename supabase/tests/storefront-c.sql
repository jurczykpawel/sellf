\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE TEMP TABLE c_fixture AS SELECT jsonb_set(published,'{templateId}','"storefront-c"') config FROM public.storefront_config;
SELECT pg_temp.assert_true(public.storefront_config_valid(config),'C localized author biography paths and projects accepted') FROM c_fixture;
SELECT pg_temp.assert_true(public.storefront_config_valid(jsonb_set(config,'{overridesByTemplate,storefront-c}','{"order":["hero"],"sections":{"story":{"visibility":"hidden"},"projects":{"visibility":"hidden"},"start":{"variant":"compact"}}}')),'C subset and optional sections accepted') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{templateId}','"storefront-unknown"')),'unknown template rejected') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{overridesByTemplate,storefront-c}','{"sections":{"paths":{"visibility":"hidden"}}}')),'C paths remain visible') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{overridesByTemplate,storefront-c}','{"sections":{"hero":{"variant":"simple"}}}')),'C variants follow descriptors') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{settingsByTemplate,storefront-c,starterProducts}','["11111111-1111-4111-8111-111111111111","11111111-1111-4111-8111-111111111111"]')),'C starter bindings are distinct') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.paths,en,items}',(config#>'{content,home.paths,en,items}') || (config#>'{content,home.paths,en,items}'))),'C path products are distinct') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.paths,en,items}',(config#>'{content,home.paths,en,items}') || jsonb_build_array(jsonb_set(config#>'{content,home.paths,en,items,0}','{productId}','"11111111-1111-4111-8111-111111111111"')))),'C path labels are distinct') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.paths,en,items}', '[{"id":"lower","productId":"abcdefab-cdef-4abc-8def-abcdefabcdef","situation":"First","body":"First path"},{"id":"upper","productId":"ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF","situation":"Second","body":"Second path"}]')),'C path UUID identity is case independent') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.paths}', '{"sourceLocale":"pl","pl":{"kind":"paths","heading":"Ścieżki","body":"Wybierz początek.","items":[{"id":"lower","productId":"abcdefab-cdef-4abc-8def-abcdefabcdef","situation":"Pierwsza","body":"Pierwsza ścieżka"},{"id":"upper","productId":"ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF","situation":"Druga","body":"Druga ścieżka"}]}}')),'C Polish path UUID identity is case independent') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.story,en,paragraphs}',to_jsonb(array_fill('Paragraph'::text,ARRAY[7])))),'C biography bounded to six paragraphs') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.projects,en,items,0,url}','"https://example.local/work"')),'C project links use public HTTPS hosts') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.projects,en,items,0,url}','"https://example.test/path?query=1"')),'C project links use plain paths') FROM c_fixture;
SELECT pg_temp.assert_true(NOT public.storefront_config_valid(jsonb_set(config,'{content,home.author,en,extra}','true')),'C author shape remains strict') FROM c_fixture;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_config_schema()','EXECUTE'),'C schema remains private');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.storefront_config','UPDATE'),'members cannot write directly');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ DECLARE original jsonb; selected text; revision bigint:=0; BEGIN
  SELECT config INTO original FROM c_fixture;
  FOREACH selected IN ARRAY ARRAY['storefront-c','storefront-a','storefront-b','d','storefront-c'] LOOP
    PERFORM pg_temp.assert_true((public.mutate_storefront_config(revision,'draft',jsonb_set(original,'{templateId}',to_jsonb(selected)),NULL,'dddddddd-0000-4000-a000-000000000000','session')->>'success')::boolean,'C retained draft switch to '||selected);
    revision:=revision+1;
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT draft=original FROM public.storefront_config),'C author copy and inactive settings round-trip exactly');
  PERFORM pg_temp.assert_true((SELECT published->>'templateId'='default' AND storefront_config.revision=5 FROM public.storefront_config),'draft switching preserves public selection');
END $$;
ROLLBACK;
