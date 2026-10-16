-- Structural wire parity on the isolated local stack.
BEGIN;
CREATE FUNCTION pg_temp.assert_wire(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
DO $$
DECLARE base jsonb := '{"format":1,"templateId":"d","settingsByTemplate":{},"overridesByTemplate":{},"content":{},"tokens":null}'; item jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements('[
    {"order":[]}, {"order":["hero"]},
    {"sections":{"tasks":{"visibility":"hidden"},"hero":{"variant":"simple"},"catalogue":{"visibility":"visible"}}},
    {"order":["hero","tasks","start","catalogue","faq","closing"],"sections":{}}
  ]'::jsonb) LOOP
    PERFORM pg_temp.assert_wire(public.storefront_config_valid(jsonb_set(base,'{overridesByTemplate}',jsonb_build_object('d',item))), 'known section intent accepted');
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements('[
    {"hidden":[]}, {"variants":{}}, {"order":["hero","hero"]}, {"order":["unknown"]},
    {"sections":{"catalogue":{"visibility":"hidden"}}}, {"sections":{"hero":{"variant":"compact"}}},
    {"sections":{"tasks":{"variant":"simple"}}}, {"sections":{"unknown":{}}}, {"sections":{"__proto__":{}}},
    {"sections":{"hero":{"other":true}}}
  ]'::jsonb) LOOP
    PERFORM pg_temp.assert_wire(NOT public.storefront_config_valid(jsonb_set(base,'{overridesByTemplate}',jsonb_build_object('d',item))), 'undeclared intent rejected');
  END LOOP;
  PERFORM pg_temp.assert_wire(NOT public.storefront_config_valid(jsonb_set(base,'{overridesByTemplate}',jsonb_build_object('d',jsonb_build_object('order',to_jsonb(array_fill('hero'::text,ARRAY[33])))))), 'order bound enforced');
END;
$$;
ROLLBACK;
