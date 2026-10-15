\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
CREATE FUNCTION pg_temp.invalid_metadata(value jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.products SET marketing_fields = value WHERE slug = 'free-tutorial';
  RETURN false;
EXCEPTION WHEN check_violation OR not_null_violation THEN RETURN true;
END;
$$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END;
$$;
SELECT pg_temp.assert_true((SELECT count(*) >= 5 FROM public.products WHERE marketing_fields->>'format' IS NOT NULL), 'representative seeded marketing');
SELECT pg_temp.assert_true((SELECT marketing_fields = '{"format":null,"sourceLocale":"en","en":{"result":null,"tools":[],"requirements":[]}}'::jsonb FROM public.products WHERE slug='pro-membership-yearly'), 'existing product receives absent defaults');
DO $$
DECLARE value jsonb; item jsonb; base jsonb := '{"format":null,"sourceLocale":"en","en":{"result":null,"tools":[],"requirements":[]}}';
BEGIN
  FOREACH value IN ARRAY ARRAY[
    'null'::jsonb, '{}'::jsonb, base || '{"format":"subscription"}', base || '{"sourceLocale":"pl"}',
    base || '{"pl":null}', base || '{"price":10}', base || '{"content_config":{}}',
    base || '{"en":{"result":null,"tools":["same","same"],"requirements":[]}}',
    base || '{"en":{"result":null,"tools":[],"requirements":[],"unknown":true}}',
    base || '{"__proto__":{}}', base || '{"en":{"tools":[],"requirements":[]}}'
  ] LOOP PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(value), 'invalid shape ' || value::text); END LOOP;
  FOREACH item IN ARRAY ARRAY[to_jsonb(repeat('a',241)), '"<b>Result</b>"', '"https://example.com"', '"www.example.com"', '"javascript:alert(1)"', '"11111111-1111-4111-8111-111111111111"', '"$10"', '"10 PLN"']::jsonb[] LOOP
    PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(jsonb_set(base,'{en,result}',item)), 'invalid result ' || item::text);
  END LOOP;
  PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(NULL), 'null metadata');
  PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(jsonb_set(base,'{en,tools}',jsonb_build_array(repeat('a',81)))), 'long tool');
  PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(jsonb_set(base,'{en,requirements}',jsonb_build_array(repeat('a',241)))), 'long requirement');
  PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(jsonb_set(base,'{en,tools}',(SELECT jsonb_agg(i::text) FROM generate_series(1,13) i))), 'many tools');
  SELECT jsonb_build_object('result',repeat('a',240),'tools',(SELECT jsonb_agg(to_hex(i)||repeat('a',79)) FROM generate_series(0,11) i),'requirements',(SELECT jsonb_agg(to_hex(i)||repeat('a',219)) FROM generate_series(0,11) i)) INTO item;
  value := jsonb_build_object('format','course','sourceLocale','en','en',item,'pl',item);
  FOR i IN 8191..8193 LOOP
    value := jsonb_build_object('format','course','sourceLocale','en','en',item,'pl',item);
    value := jsonb_set(value,'{pl,result}',to_jsonb(repeat('é',i-octet_length(value::text)) || repeat('a',240-i+octet_length(value::text))));
    PERFORM pg_temp.assert_true(octet_length(value::text)=i, 'stored bytes ' || i);
    IF i <= 8192 THEN UPDATE public.products SET marketing_fields=value WHERE slug='free-tutorial';
    ELSE PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(value), 'stored limit denied'); END IF;
  END LOOP;
END;
$$;
DO $$
DECLARE value jsonb; saved jsonb; format_name text;
BEGIN
  FOREACH format_name IN ARRAY ARRAY['course','workshop','ebook','template','tool','service','bundle','other'] LOOP
    value := jsonb_build_object('format',format_name,'sourceLocale','pl','en',jsonb_build_object('result','Build a report','tools',jsonb_build_array('n8n'),'requirements','[]'::jsonb),'pl',jsonb_build_object('result','Zbuduj raport','tools',jsonb_build_array('n8n'),'requirements',jsonb_build_array('Podstawy arkuszy')));
    UPDATE public.products SET marketing_fields=value WHERE slug='free-tutorial' RETURNING marketing_fields INTO saved;
    PERFORM pg_temp.assert_true(saved=value, 'translated round-trip ' || format_name);
  END LOOP;
  UPDATE public.products SET marketing_fields=jsonb_set(marketing_fields,'{en,result}',to_jsonb(repeat('😀',240))) WHERE slug='free-tutorial';
  PERFORM pg_temp.assert_true(pg_temp.invalid_metadata(jsonb_set(value,'{en,result}',to_jsonb(repeat('😀',241)))), 'Unicode result limit');
END;
$$;
SELECT pg_temp.assert_true((SELECT price=0 AND product_type='one_time' FROM public.products WHERE slug='free-tutorial'),'free pricing unchanged');
SELECT pg_temp.assert_true((SELECT price=0 AND recurring_price=49 AND product_type='subscription' AND marketing_fields->>'sourceLocale'='pl' FROM public.products WHERE slug='pro-membership-monthly'),'subscription pricing unchanged');
SELECT pg_temp.assert_true((SELECT is_bundle AND marketing_fields->>'format'='bundle' FROM public.products WHERE slug='starter-bundle'),'bundle metadata round-trip');
SELECT pg_temp.assert_true((SELECT NOT is_active AND length(marketing_fields#>>'{en,result}')=240 FROM public.products WHERE slug='sample-workshop-unavailable'),'unavailable long copy round-trip');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true((SELECT count(*) > 0 FROM public.products WHERE marketing_fields IS NOT NULL), 'anon reads visible marketing');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT content_config FROM public.products'), 'delivery column unchanged');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT license_tier FROM public.products'), 'license column unchanged');
SELECT pg_temp.assert_true(pg_temp.denied('UPDATE public.products SET marketing_fields = DEFAULT'), 'anon cannot write');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.products WHERE slug='sample-workshop-unavailable'), 'inactive product omitted');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bbbbbbbb-0000-4000-a000-000000000000"}',true);
WITH changed AS (UPDATE public.products SET marketing_fields=DEFAULT RETURNING id) SELECT pg_temp.assert_true(count(*)=0,'member cannot write') FROM changed;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dddddddd-0000-4000-a000-000000000000"}',true);
WITH changed AS (UPDATE public.products SET marketing_fields=DEFAULT WHERE slug='free-tutorial' RETURNING id) SELECT pg_temp.assert_true(count(*)=1,'admin retains authorized write') FROM changed;
RESET ROLE;
ROLLBACK;
