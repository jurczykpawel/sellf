-- D-057 security and resource limits, without the reference extension.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname LIKE 'jsonschema_subset_%' AND (provolatile<>'i' OR prosecdef OR proconfig<>ARRAY['search_path=""'])
), 'private helpers are immutable invokers with empty search_path');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM pg_proc p CROSS JOIN (VALUES ('anon'),('authenticated')) r(name)
  WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'jsonschema_subset_%'
  AND has_function_privilege(r.name,p.oid,'EXECUTE')
), 'anon/authenticated cannot execute generic validators');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.product_marketing_valid(jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.product_marketing_valid(jsonb)','EXECUTE'), 'only product writers can invoke fixed marketing schema');
SELECT pg_temp.assert_true(public.jsonschema_subset_matches('{}','null'), 'JSON null is a value');
SELECT pg_temp.assert_true(public.jsonschema_subset_matches('{}',NULL) IS NULL, 'SQL null is strict');
SELECT pg_temp.assert_true(NOT public.jsonschema_subset_matches('{"minimum":1}','1'), 'unknown keyword fails closed');
SELECT pg_temp.assert_true(NOT public.jsonschema_subset_matches('{"pattern":".*"}','"text"'), 'unknown pattern fails closed');
SELECT pg_temp.assert_true(public.jsonschema_subset_matches('{"format":"uuid"}','"not-a-uuid"'), 'format is reference annotation');
SELECT pg_temp.assert_true(NOT public.jsonschema_subset_matches('{"required":["x"],"properties":{"x":{"default":1}}}','{}'), 'default does not satisfy required');
SELECT pg_temp.assert_true(NOT public.jsonschema_subset_matches('{"uniqueItems":true}','[{"a":1,"b":2},{"b":2,"a":1}]'), 'object equality for uniqueItems');
SELECT pg_temp.assert_true(public.jsonschema_subset_matches('{"maxLength":1}','"😀"'), 'maxLength counts codepoints');
SELECT pg_temp.assert_true(NOT public.product_marketing_valid(jsonb_build_object(
  'format',null,'sourceLocale','en','en',jsonb_build_object(
    'result','$'||chr(13)||'12','tools','[]'::jsonb,'requirements','[]'::jsonb))),
  'carriage return survives generated regex and RPC transport');
SELECT pg_temp.assert_true(NOT public.jsonschema_subset_matches('{}',to_jsonb(repeat('x',102399))), 'serialized instance limit');
SELECT pg_temp.assert_true(NOT public.jsonschema_subset_matches(json_build_object('default',repeat('x',131072)),'null'), 'serialized schema limit');
DO $$
DECLARE schema jsonb := '{"type":"string"}'; instance jsonb := '"ok"'; result record;
BEGIN
  FOR i IN 1..33 LOOP schema := jsonb_build_object('items',schema); instance:=jsonb_build_array(instance); END LOOP;
  PERFORM pg_temp.assert_true(NOT public.jsonschema_subset_matches(schema::json,instance), 'depth is bounded');
  SELECT * INTO result FROM public.jsonschema_subset_walk('{"anyOf":[{"const":1},{"const":2},{"const":3}]}','3',0,3);
  PERFORM pg_temp.assert_true(NOT result.valid AND result.remaining<0, 'failed anyOf branches share budget');
  SELECT * INTO result FROM public.jsonschema_subset_walk('{"items":{}}','[1,2,3]',0,3);
  PERFORM pg_temp.assert_true(NOT result.valid AND result.remaining<0, 'array siblings share budget');
END; $$;
ROLLBACK;
