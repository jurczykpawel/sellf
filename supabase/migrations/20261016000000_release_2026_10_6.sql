-- Sellf 2026.10.6

-- Storefront templates.
-- Storefront snapshots. See spec/contracts/storefront-config.md.
CREATE TABLE public.storefront_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  draft jsonb,
  published jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (octet_length(published::text) <= 102400),
  CHECK (draft IS NULL OR octet_length(draft::text) <= 102400)
);
CREATE INDEX storefront_config_updated_by ON public.storefront_config(updated_by);

CREATE TABLE public.storefront_config_history (
  revision bigint PRIMARY KEY CHECK (revision BETWEEN 0 AND 9007199254740991),
  operation text NOT NULL CHECK (operation IN ('draft','publish','rollback','reset','legacy-import')),
  draft jsonb,
  published jsonb NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_from bigint REFERENCES public.storefront_config_history(revision),
  CHECK (octet_length(published::text) <= 102400),
  CHECK (draft IS NULL OR octet_length(draft::text) <= 102400)
);
CREATE INDEX storefront_history_actor ON public.storefront_config_history(actor_id);
CREATE INDEX storefront_history_restored ON public.storefront_config_history(restored_from);

ALTER TABLE public.storefront_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_config_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_admin_read ON public.storefront_config FOR SELECT TO authenticated
  USING ((select public.is_admin()));
CREATE POLICY history_admin_read ON public.storefront_config_history FOR SELECT TO authenticated
  USING ((select public.is_admin()));
CREATE POLICY config_service ON public.storefront_config FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY history_service_insert ON public.storefront_config_history FOR INSERT TO service_role
  WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY history_service_read ON public.storefront_config_history FOR SELECT TO service_role
  USING ((select auth.role()) = 'service_role');

-- Replace inherited defaults with the snapshot contract's explicit grants.
REVOKE ALL ON public.storefront_config, public.storefront_config_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.storefront_config, public.storefront_config_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.storefront_config TO service_role;
GRANT SELECT, INSERT ON public.storefront_config_history TO service_role;

CREATE FUNCTION public.storefront_config_stored_bytes(config jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = ''
AS $$ SELECT pg_catalog.octet_length(config::text); $$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_stored_bytes(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_stored_bytes(jsonb) TO service_role;

-- Bootstrap installed instances as well as fresh local databases.
INSERT INTO public.storefront_config(published)
VALUES ('{"format":1,"templateId":"default","settingsByTemplate":{},"overridesByTemplate":{},"content":{},"tokens":null}');
INSERT INTO public.storefront_config_history(revision, operation, published)
SELECT revision, 'legacy-import', published FROM public.storefront_config;

-- D-057: bounded validator for generated schemas, not a general JSON-Schema engine.
-- Pattern translations below are generated from the same allowlist as the TS gate.
-- validator-patterns:start
CREATE FUNCTION public.jsonschema_subset_pattern(pattern text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $patterns$
  SELECT CASE pattern
    WHEN '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    WHEN '^[a-z][a-z0-9-]{0,63}$' THEN '^[a-z][a-z0-9-]{0,63}$'
    WHEN '^#[0-9A-Fa-f]{6}$' THEN '^#[0-9A-Fa-f]{6}$'
    WHEN '^(?![\s\S]*<[^>]*>)[\s\S]*$' THEN '^(?!.*<[^>]*>).*$'
    WHEN '^(?![\s\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\/\/|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\u20AC\u00A3]\s*\d|\d\s*(?:USD|EUR|PLN|GBP|z\u0142)|[\u0000\uFEFF\uFFFD]))[\s\S]*$' THEN '^(?!.*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|://|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$€£][\u0009-\u000d\u0020\u00a0\u2003\u2029\ufeff]*[0-9]|[0-9][\u0009-\u000d\u0020\u00a0\u2003\u2029\ufeff]*(?:USD|EUR|PLN|GBP|zł)|[﻿�])).*$'
    ELSE NULL END;
$patterns$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) TO service_role;
-- validator-patterns:end

CREATE FUNCTION public.jsonschema_subset_walk(schema jsonb, instance jsonb, depth integer, budget integer)
RETURNS TABLE (valid boolean, remaining integer)
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  keyword text; child jsonb; property record; result record;
  kind text := pg_catalog.jsonb_typeof(instance); matched boolean; expression text;
BEGIN
  valid := false; remaining := budget - 1;
  <<validate>> BEGIN
    IF depth > 32 OR remaining < 0 OR pg_catalog.jsonb_typeof(schema) <> 'object' THEN EXIT validate; END IF;
    FOR keyword IN SELECT pg_catalog.jsonb_object_keys(schema) LOOP
      IF keyword NOT IN ('type','properties','required','additionalProperties','items','anyOf','enum','const',
        'maxLength','maxItems','uniqueItems','pattern','format','default') THEN EXIT validate; END IF;
    END LOOP;
    IF schema ? 'type' THEN
      IF schema->>'type' = 'integer' THEN
        IF kind <> 'number' OR (instance::text)::numeric <> pg_catalog.trunc((instance::text)::numeric) THEN EXIT validate; END IF;
      ELSIF schema->>'type' NOT IN ('object','array','string','number','boolean','null') OR kind <> schema->>'type' THEN EXIT validate;
      END IF;
    END IF;
    IF schema ? 'const' AND instance <> schema->'const' THEN EXIT validate; END IF;
    IF schema ? 'enum' AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(schema->'enum') item WHERE item=instance) THEN EXIT validate; END IF;
    IF schema ? 'anyOf' THEN
      matched := false;
      FOR child IN SELECT value FROM pg_catalog.jsonb_array_elements(schema->'anyOf') LOOP
        SELECT * INTO result FROM public.jsonschema_subset_walk(child,instance,depth+1,remaining);
        remaining := result.remaining;
        IF remaining < 0 THEN EXIT validate; END IF;
        IF result.valid THEN matched := true; EXIT; END IF;
      END LOOP;
      IF NOT matched THEN EXIT validate; END IF;
    END IF;
    IF kind = 'object' THEN
      IF schema ? 'required' AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(schema->'required') required WHERE NOT instance ? required) THEN EXIT validate; END IF;
      FOR property IN SELECT * FROM pg_catalog.jsonb_each(instance) LOOP
        child := schema->'properties'->property.key;
        IF child IS NULL THEN
          IF schema->'additionalProperties' = 'false'::jsonb THEN EXIT validate; END IF;
          IF pg_catalog.jsonb_typeof(schema->'additionalProperties') = 'object' THEN child := schema->'additionalProperties'; END IF;
        END IF;
        IF child IS NOT NULL THEN
          SELECT * INTO result FROM public.jsonschema_subset_walk(child,property.value,depth+1,remaining);
          remaining := result.remaining;
          IF NOT result.valid THEN EXIT validate; END IF;
        END IF;
      END LOOP;
    ELSIF kind = 'array' THEN
      IF schema ? 'maxItems' AND pg_catalog.jsonb_array_length(instance) > (schema->>'maxItems')::numeric THEN EXIT validate; END IF;
      IF schema->'uniqueItems' = 'true'::jsonb AND
        (SELECT count(*) <> count(DISTINCT value) FROM pg_catalog.jsonb_array_elements(instance)) THEN EXIT validate; END IF;
      IF schema ? 'items' THEN
        FOR child IN SELECT value FROM pg_catalog.jsonb_array_elements(instance) LOOP
          SELECT * INTO result FROM public.jsonschema_subset_walk(schema->'items',child,depth+1,remaining);
          remaining := result.remaining;
          IF NOT result.valid THEN EXIT validate; END IF;
        END LOOP;
      END IF;
    ELSIF kind = 'string' THEN
      IF schema ? 'maxLength' AND pg_catalog.char_length(instance #>> '{}') > (schema->>'maxLength')::numeric THEN EXIT validate; END IF;
      IF schema ? 'pattern' THEN
        expression := public.jsonschema_subset_pattern(schema->>'pattern');
        -- C collation avoids locale expansion of ASCII ranges. Default PG regex
        -- mode is newline-insensitive: '.' also matches line terminators.
        IF expression IS NULL OR NOT ((instance #>> '{}') COLLATE pg_catalog."C" ~ expression) THEN EXIT validate; END IF;
      END IF;
      -- pg_jsonschema 0.3.3 treats format as annotation (including uuid).
      -- Only this emitted format is admitted by the generator.
      IF schema ? 'format' AND schema->>'format' <> 'uuid' THEN EXIT validate; END IF;
    END IF;
    -- 'default' is an annotation; missing properties are never filled in.
    valid := true;
  END validate;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_walk(jsonb,jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_walk(jsonb,jsonb,integer,integer) TO service_role;

CREATE FUNCTION public.jsonschema_subset_matches(schema json, instance jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Bound serialized input before walking; shared node budget includes failed
  -- anyOf branches, preventing exponential branch amplification.
  IF pg_catalog.octet_length(schema::text) > 131072 OR pg_catalog.octet_length(instance::text) > 102400 THEN RETURN false; END IF;
  RETURN (SELECT valid FROM public.jsonschema_subset_walk(schema::jsonb,instance,0,16384));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_matches(json,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_matches(json,jsonb) TO service_role;
-- storefront-schema:start (generated by generate-storefront-schema.ts)
CREATE FUNCTION public.storefront_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '{"type":"object","properties":{"format":{"type":"number","const":1},"templateId":{"type":"string","enum":["default","d"]},"settingsByTemplate":{"type":"object","properties":{"d":{"type":"object","properties":{"heroProduct":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"closingProduct":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"starterProducts":{"maxItems":3,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true},"taskCategories":{"maxItems":12,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true},"density":{"type":"string","enum":["comfortable","compact"]}},"additionalProperties":false},"default":{"type":"object","properties":{},"additionalProperties":false}},"additionalProperties":false},"overridesByTemplate":{"type":"object","properties":{"d":{"type":"object","properties":{"order":{"maxItems":32,"type":"array","items":{"type":"string","enum":["hero","tasks","start","catalogue","faq","closing"]},"uniqueItems":true},"sections":{"type":"object","properties":{"hero":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["split-process","simple"]}},"additionalProperties":false},"tasks":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]}},"additionalProperties":false},"start":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]},"variant":{"type":"string","enum":["detail-cards","compact"]}},"additionalProperties":false},"catalogue":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["detail-cards","default-groups"]}},"additionalProperties":false},"faq":{"type":"object","properties":{"visibility":{"type":"string","enum":["visible","hidden"]}},"additionalProperties":false},"closing":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false},"default":{"type":"object","properties":{"order":{"maxItems":32,"type":"array","items":{"type":"string","enum":["catalogue"]},"uniqueItems":true},"sections":{"type":"object","properties":{"catalogue":{"type":"object","properties":{"visibility":{"type":"string","const":"visible"},"variant":{"type":"string","enum":["detail-cards","default-groups"]}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false}},"additionalProperties":false},"content":{"type":"object","properties":{"home.hero":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.tasks":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.starts":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"heading"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.faq":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"home.closing":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]}},"additionalProperties":false},"tokens":{"anyOf":[{"type":"object","properties":{"format":{"type":"number","const":1},"light":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"additionalProperties":false},"dark":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"additionalProperties":false},"typography":{"type":"object","properties":{"font":{"type":"string","enum":["geist","dm-sans"]},"bodyWeight":{"anyOf":[{"type":"number","const":400},{"type":"number","const":500}]},"headingWeight":{"anyOf":[{"type":"number","const":500},{"type":"number","const":600},{"type":"number","const":700}]},"baseSizePx":{"anyOf":[{"type":"number","const":16},{"type":"number","const":17},{"type":"number","const":18}]},"headingLetterSpacingEm":{"anyOf":[{"type":"number","const":-0.02},{"type":"number","const":-0.01},{"type":"number","const":0}]}},"additionalProperties":false},"shapes":{"type":"object","properties":{"radiusSmPx":{"anyOf":[{"type":"number","const":0},{"type":"number","const":4},{"type":"number","const":8}]},"radiusMdPx":{"anyOf":[{"type":"number","const":4},{"type":"number","const":8},{"type":"number","const":12}]},"radiusLgPx":{"anyOf":[{"type":"number","const":8},{"type":"number","const":12},{"type":"number","const":16},{"type":"number","const":24}]}},"additionalProperties":false}},"required":["format"],"additionalProperties":false},{"type":"null"}]}},"required":["format","templateId","settingsByTemplate","overridesByTemplate","content","tokens"],"additionalProperties":false}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;
-- storefront-schema:end

CREATE FUNCTION public.storefront_config_valid(config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT public.jsonschema_subset_matches(public.storefront_config_schema(), config) THEN RETURN false; END IF;
  IF EXISTS (
    WITH RECURSIVE nodes(value, depth) AS (
      SELECT config, 0 UNION ALL
      SELECT child.value, nodes.depth + 1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM pg_catalog.jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
        UNION ALL SELECT value FROM pg_catalog.jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
      ) child WHERE nodes.depth <= 12
    ) SELECT 1 FROM nodes WHERE depth > 12 OR
      (jsonb_typeof(value)='string' AND (value #>> '{}') ~ U&'[\FEFF\FFFD]') OR
      (jsonb_typeof(value)='object' AND value ?| ARRAY['__proto__','prototype','constructor'])
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config->'content') slot CROSS JOIN LATERAL pg_catalog.jsonb_each(slot.value) locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') GROUP BY slot.key, locale.key
    HAVING count(*) <> count(DISTINCT item->>'id')
  ) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_valid(jsonb) TO service_role;

CREATE FUNCTION public.mutate_storefront_config(expected_revision bigint, operation text, validated_config jsonb,
  restored_from bigint DEFAULT NULL, actor_user_id uuid DEFAULT NULL, actor_method text DEFAULT NULL, actor_api_key_id uuid DEFAULT NULL, legacy_source jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current_config public.storefront_config%ROWTYPE;
  next_draft jsonb; next_published jsonb; owner_id uuid; key_record public.api_keys%ROWTYPE;
  required_scope text; candidate jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
  SELECT * INTO current_config FROM public.storefront_config WHERE id=true FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','UNAVAILABLE'); END IF;
  SELECT id INTO owner_id FROM public.admin_users WHERE user_id=actor_user_id FOR SHARE;
  IF actor_user_id IS NULL OR owner_id IS NULL OR actor_method IS NULL OR actor_method NOT IN ('session','api_key') OR
    (actor_method='session' AND actor_api_key_id IS NOT NULL) THEN
    RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
  END IF;
  required_scope := CASE WHEN operation IN ('publish','rollback') THEN 'templates:activate' ELSE 'templates:write' END;
  IF actor_method='api_key' THEN
    SELECT * INTO key_record FROM public.api_keys WHERE id=actor_api_key_id FOR SHARE;
    IF NOT FOUND OR key_record.admin_user_id IS DISTINCT FROM owner_id OR key_record.revoked_at IS NOT NULL OR
      (NOT key_record.is_active AND (key_record.rotation_grace_until IS NULL OR key_record.rotation_grace_until <= clock_timestamp())) OR
      (key_record.expires_at IS NOT NULL AND key_record.expires_at <= clock_timestamp()) OR
      NOT (key_record.scopes @> jsonb_build_array(required_scope)) THEN
      RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
    END IF;
  END IF;
  IF expected_revision IS NULL OR expected_revision NOT BETWEEN 0 AND 9007199254740991 OR
    (restored_from IS NOT NULL AND restored_from NOT BETWEEN 0 AND 9007199254740991) THEN
    RETURN jsonb_build_object('success',false,'code','LIMIT','path','/expectedRevision','limit',9007199254740991);
  END IF;
  IF expected_revision <> current_config.revision THEN
    RETURN jsonb_build_object('success',false,'code','CONFLICT','currentRevision',current_config.revision);
  END IF;
  IF current_config.revision=9007199254740991 THEN RETURN jsonb_build_object('success',false,'code','LIMIT','path','/expectedRevision','limit',9007199254740991); END IF;
  IF operation IS NULL OR operation NOT IN ('draft','reset','legacy-import','publish','rollback') OR
    (operation <> 'rollback' AND restored_from IS NOT NULL) THEN
    RETURN jsonb_build_object('success',false,'code','INVALID');
  END IF;
  IF operation='legacy-import' THEN
    IF legacy_source IS NULL OR jsonb_typeof(legacy_source) IS DISTINCT FROM 'object' OR
      NOT (legacy_source ?& ARRAY['sha256','byteLength']) OR
      (legacy_source - 'sha256' - 'byteLength') <> '{}'::jsonb OR
      jsonb_typeof(legacy_source->'sha256') IS DISTINCT FROM 'string' OR
      (legacy_source->>'sha256') !~ '^[a-f0-9]{64}$' OR
      jsonb_typeof(legacy_source->'byteLength') IS DISTINCT FROM 'number' THEN
      RETURN jsonb_build_object('success',false,'code','INVALID');
    END IF;
    IF (legacy_source->>'byteLength')::numeric NOT BETWEEN 0 AND 102400 OR
      trunc((legacy_source->>'byteLength')::numeric) <> (legacy_source->>'byteLength')::numeric THEN
      RETURN jsonb_build_object('success',false,'code','INVALID');
    END IF;
  ELSIF legacy_source IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','INVALID');
  END IF;
  next_draft := current_config.draft; next_published := current_config.published;
  IF operation IN ('draft','reset','legacy-import') THEN
    next_draft := validated_config; candidate := validated_config;
  ELSIF operation='publish' THEN
    IF validated_config IS NOT NULL OR current_config.draft IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
    next_published := current_config.draft; next_draft := NULL; candidate := next_published;
  ELSE
    IF validated_config IS NOT NULL OR restored_from IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
    SELECT h.published INTO next_published FROM public.storefront_config_history h WHERE h.revision=mutate_storefront_config.restored_from;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
    next_draft := NULL; candidate := next_published;
  END IF;
  IF public.storefront_config_stored_bytes(candidate) > 102400 OR public.storefront_config_stored_bytes(next_published) > 102400 THEN
    RETURN jsonb_build_object('success',false,'code','LIMIT','path','/config','limit',102400);
  END IF;
  IF candidate IS NULL OR public.storefront_config_valid(candidate) IS DISTINCT FROM true OR
    (operation IN ('publish','rollback') AND public.storefront_config_valid(next_published) IS DISTINCT FROM true) THEN
    RETURN jsonb_build_object('success',false,'code','INVALID');
  END IF;
  UPDATE public.storefront_config SET revision=current_config.revision+1, draft=next_draft, published=next_published,
    updated_at=clock_timestamp(), updated_by=actor_user_id WHERE id=true;
  INSERT INTO public.storefront_config_history(revision,operation,draft,published,actor_id,restored_from)
  VALUES(current_config.revision+1,operation,next_draft,next_published,actor_user_id,restored_from);
  INSERT INTO public.audit_log(table_name,operation,user_id,performed_by,new_values)
  VALUES('storefront_config','UPDATE',actor_user_id,actor_user_id,jsonb_build_object(
    'revision',current_config.revision+1,'templateId',candidate->>'templateId','action',operation,
    'scope',required_scope,'actor_method',actor_method,'actor_api_key_id',actor_api_key_id) ||
    CASE WHEN operation='legacy-import' THEN jsonb_build_object('legacySource',legacy_source) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('success',true,'revision',current_config.revision+1);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'code','UNAVAILABLE');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mutate_storefront_config(bigint,text,jsonb,bigint,uuid,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_storefront_config(bigint,text,jsonb,bigint,uuid,text,uuid,jsonb) TO service_role;

ALTER TABLE public.api_keys
  ALTER COLUMN scopes SET DEFAULT jsonb_build_array(
    'products:read',
    'products:write',
    'users:read',
    'users:write',
    'coupons:read',
    'coupons:write',
    'analytics:read',
    'payments:read',
    'payments:write',
    'payments:refund',
    'webhooks:read',
    'webhooks:write',
    'integrations:write',
    'refund-requests:read',
    'refund-requests:write',
    'templates:read',
    'templates:write',
    'templates:activate',
    'system:read',
    'system:write'
  );


-- Product editorial metadata. See spec/contracts/product-marketing-fields.md.
ALTER TABLE public.products ADD COLUMN marketing_fields jsonb NOT NULL
  DEFAULT '{"format":null,"sourceLocale":"en","en":{"result":null,"tools":[],"requirements":[]}}'::jsonb;
ALTER TABLE public.products ADD CONSTRAINT products_marketing_size
  CHECK (octet_length(marketing_fields::text) <= 8192);
-- marketing-schema:start (generated by bun run template:schema)
-- Authenticated admins also write products directly under RLS. This pure
-- validation wrapper lets the CHECK invoke the private helpers without exposing
-- a caller-supplied schema or privileged data access.
CREATE FUNCTION public.product_marketing_valid(instance jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path = ''
AS $schema$ SELECT public.jsonschema_subset_matches('{"anyOf":[{"type":"object","properties":{"format":{"anyOf":[{"type":"string","enum":["course","workshop","ebook","template","tool","service","bundle","other"]},{"type":"null"}]},"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"result":{"anyOf":[{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},{"type":"null"}]},"tools":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":80},"uniqueItems":true},"requirements":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},"uniqueItems":true}},"required":["result","tools","requirements"],"additionalProperties":false},"pl":{"type":"object","properties":{"result":{"anyOf":[{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},{"type":"null"}]},"tools":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":80},"uniqueItems":true},"requirements":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},"uniqueItems":true}},"required":["result","tools","requirements"],"additionalProperties":false}},"required":["format","sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"format":{"anyOf":[{"type":"string","enum":["course","workshop","ebook","template","tool","service","bundle","other"]},{"type":"null"}]},"sourceLocale":{"type":"string","const":"pl"},"en":{"type":"object","properties":{"result":{"anyOf":[{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},{"type":"null"}]},"tools":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":80},"uniqueItems":true},"requirements":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},"uniqueItems":true}},"required":["result","tools","requirements"],"additionalProperties":false},"pl":{"type":"object","properties":{"result":{"anyOf":[{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},{"type":"null"}]},"tools":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":80},"uniqueItems":true},"requirements":{"maxItems":12,"type":"array","items":{"type":"string","pattern":"^(?![\\s\\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\\/\\/|[wW][wW][wW]\\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\\u20AC\\u00A3]\\s*\\d|\\d\\s*(?:USD|EUR|PLN|GBP|z\\u0142)|[\\u0000\\uFEFF\\uFFFD]))[\\s\\S]*$","maxLength":240},"uniqueItems":true}},"required":["result","tools","requirements"],"additionalProperties":false}},"required":["format","sourceLocale","pl"],"additionalProperties":false}]}'::json, instance); $schema$;
REVOKE EXECUTE ON FUNCTION public.product_marketing_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_marketing_valid(jsonb) TO authenticated, service_role;
ALTER TABLE public.products ADD CONSTRAINT products_marketing_shape
  CHECK (public.product_marketing_valid(marketing_fields));
-- marketing-schema:end
GRANT SELECT (marketing_fields) ON public.products TO anon, authenticated;

-- Bounded public product inputs for the server-side storefront adapters.
CREATE INDEX storefront_products_order ON public.products(created_at DESC, id ASC)
  WHERE is_active AND is_listed;

-- Sparse groups must not walk the complete public ordering index.
CREATE INDEX storefront_products_featured ON public.products(created_at DESC, id ASC)
  WHERE is_active AND is_listed AND is_featured;
CREATE INDEX storefront_products_free ON public.products(created_at DESC, id ASC)
  WHERE is_active AND is_listed AND product_type<>'subscription' AND NOT allow_custom_price AND price=0;
CREATE INDEX storefront_products_paid ON public.products(created_at DESC, id ASC)
  WHERE is_active AND is_listed AND NOT (product_type<>'subscription' AND NOT allow_custom_price AND price=0);
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX storefront_products_name_trgm ON public.products USING gin (normalize(name,NFC) extensions.gin_trgm_ops)
  WHERE is_active AND is_listed;
-- Partial expression-index statistics do not supply common-term selectivity.
-- Global expression statistics let the planner choose the ordered seek instead.
CREATE STATISTICS public.storefront_products_name ON (normalize(name,NFC)) FROM public.products;
ANALYZE public.products;
CREATE INDEX storefront_products_available_from ON public.products(available_from) WHERE is_active AND is_listed;
CREATE INDEX storefront_products_available_until ON public.products(available_until) WHERE is_active AND is_listed;
CREATE INDEX storefront_products_sale_until ON public.products(sale_price_until) WHERE is_active AND is_listed;

-- Each branch seeks one boundary, including future arrivals absent from cached pages.
CREATE FUNCTION public.storefront_catalogue_boundary() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT min(boundary) FROM (
    (SELECT available_from boundary FROM public.products WHERE is_active AND is_listed AND available_from>statement_timestamp() ORDER BY available_from LIMIT 1)
    UNION ALL
    (SELECT available_until FROM public.products WHERE is_active AND is_listed AND available_until>statement_timestamp() ORDER BY available_until LIMIT 1)
    UNION ALL
    (SELECT sale_price_until FROM public.products WHERE is_active AND is_listed AND sale_price_until>statement_timestamp() ORDER BY sale_price_until LIMIT 1)
  ) boundaries;
$$;
REVOKE ALL ON FUNCTION public.storefront_catalogue_boundary() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_catalogue_boundary() TO service_role;

CREATE FUNCTION public.storefront_catalogue_page(
  filters jsonb DEFAULT '{}', after_created timestamptz DEFAULT NULL,
  after_id uuid DEFAULT NULL, product_ids uuid[] DEFAULT NULL
) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  page_size integer := coalesce((filters->>'pageSize')::integer, 9);
  search_text text := normalize(btrim(coalesce(filters->>'search','')), NFC);
  categories uuid[];
  price_kind text := filters->>'priceKind';
  product_format text := filters->>'format';
  group_name text := coalesce(filters->>'group','all');
BEGIN
  IF jsonb_typeof(filters) IS DISTINCT FROM 'object' OR page_size NOT IN (9,12,24)
    OR char_length(search_text)>100 OR group_name NOT IN ('all','featured','free','paid')
    OR (price_kind IS NOT NULL AND price_kind NOT IN ('free','one-time','subscription','pwyw'))
    OR (product_format IS NOT NULL AND product_format NOT IN ('course','workshop','ebook','template','tool','service','bundle','other'))
    OR (after_created IS NULL) <> (after_id IS NULL)
    OR cardinality(product_ids)>5 THEN RAISE EXCEPTION 'INVALID' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO categories
    FROM jsonb_array_elements_text(coalesce(filters->'categoryIds','[]')) value;
  IF cardinality(categories)>12 OR cardinality(categories)<>(SELECT count(DISTINCT c) FROM unnest(categories) c)
    THEN RAISE EXCEPTION 'INVALID' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH eligible AS NOT MATERIALIZED (
    SELECT p.id,p.name,p.slug,left(p.description,280) description,p.created_at,p.price,p.currency,p.product_type,p.recurring_price,
      p.billing_interval,p.billing_interval_count,p.allow_custom_price,p.custom_price_min,
      p.sale_price,p.sale_price_until,p.sale_quantity_limit,p.sale_quantity_sold,
      p.marketing_fields,left(p.image_url,2049) image_url,p.vat_rate,p.vat_exempt,
      left(p.vat_exempt_note,501) vat_exempt_note,p.price_includes_vat,p.omnibus_exempt,
      p.auto_grant_duration_days,p.available_until
    FROM public.products p
    -- The unique junction key makes the per-candidate count an intersection.
    CROSS JOIN LATERAL (
      SELECT count(*) FROM public.product_categories pc
      WHERE pc.product_id=p.id AND pc.category_id=ANY(categories)
      HAVING count(*)=cardinality(categories)
    ) membership
    WHERE p.is_active AND p.is_listed
      AND (p.available_from IS NULL OR p.available_from<=statement_timestamp())
      AND (p.available_until IS NULL OR p.available_until>statement_timestamp())
      AND (product_ids IS NULL OR p.id=ANY(product_ids))
      AND (search_text='' OR normalize(p.name,NFC) ILIKE '%' || replace(replace(replace(search_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%')
      AND (product_format IS NULL OR p.marketing_fields->>'format'=product_format)
      AND (group_name<>'featured' OR p.is_featured)
      AND (price_kind IS NULL OR price_kind=CASE WHEN p.product_type='subscription' THEN 'subscription'
        WHEN p.allow_custom_price THEN 'pwyw' WHEN p.price=0 THEN 'free' ELSE 'one-time' END)
      AND (group_name<>'free' OR (p.product_type<>'subscription' AND NOT p.allow_custom_price AND p.price=0))
      AND (group_name<>'paid' OR NOT (p.product_type<>'subscription' AND NOT p.allow_custom_price AND p.price=0))
  ), page AS MATERIALIZED (
    SELECT * FROM (
      (SELECT * FROM eligible WHERE after_created IS NULL OR created_at<after_created ORDER BY created_at DESC,id ASC LIMIT page_size+1)
      UNION ALL
      (SELECT * FROM eligible WHERE created_at=after_created AND id>after_id ORDER BY created_at DESC,id ASC LIMIT page_size+1)
    ) candidates ORDER BY created_at DESC,id ASC LIMIT page_size+1
  ), shop AS MATERIALIZED (
    SELECT tax_mode,omnibus_enabled FROM public.shop_config LIMIT 1
  ), history AS (
    SELECT h.product_id,h.price,h.sale_price,h.effective_from,
      max(h.effective_from) OVER (PARTITION BY h.product_id) latest
    FROM public.omnibus_price_history h JOIN page p ON p.id=h.product_id
    WHERE h.effective_from>=statement_timestamp()-interval '30 days'
  ), prior AS (
    SELECT product_id,min(CASE WHEN effective_from=latest THEN price ELSE least(price,coalesce(sale_price,price)) END) lowest
    FROM history GROUP BY product_id
  )
  SELECT (to_jsonb(p)-'omnibus_exempt') || jsonb_build_object(
    'tax_mode',coalesce(shop.tax_mode,'local'),
    'lowest_prior_price',CASE WHEN NOT p.omnibus_exempt AND coalesce(shop.omnibus_enabled,false) THEN prior.lowest ELSE NULL END)
  FROM page p LEFT JOIN prior ON prior.product_id=p.id LEFT JOIN shop ON true ORDER BY p.created_at DESC,p.id ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_catalogue_page(jsonb,timestamptz,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_catalogue_page(jsonb,timestamptz,uuid,uuid[]) TO service_role;

CREATE FUNCTION public.storefront_catalogue_categories(category_ids uuid[])
RETURNS TABLE(id uuid,name text) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF cardinality(category_ids)>12 THEN RAISE EXCEPTION 'INVALID' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT c.id,c.name FROM public.categories c
    CROSS JOIN LATERAL (SELECT 1 FROM public.product_categories pc JOIN public.products p ON p.id=pc.product_id
      WHERE pc.category_id=c.id AND p.is_active AND p.is_listed
      AND (p.available_from IS NULL OR p.available_from<=statement_timestamp())
      AND (p.available_until IS NULL OR p.available_until>statement_timestamp()) LIMIT 1) available
    WHERE c.id=ANY(category_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_catalogue_categories(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_catalogue_categories(uuid[]) TO service_role;

-- Release operations.

-- Replace a webhook secret and record the actor in a single transaction.
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(
  p_endpoint_id uuid,
  p_secret text,
  p_actor_id uuid,
  p_api_key_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_actor_id) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;
  IF p_secret IS NULL OR p_secret NOT LIKE 'enc:v1:%' THEN
    RAISE EXCEPTION 'Encrypted secret required';
  END IF;

  UPDATE public.webhook_endpoints
  SET secret = p_secret, updated_at = now()
  WHERE id = p_endpoint_id;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_log (table_name, operation, new_values, performed_by)
  VALUES ('webhook_endpoints', 'UPDATE', jsonb_build_object(
    'id', p_endpoint_id,
    'action', 'secret_rotated',
    'api_key_id', p_api_key_id
  ), p_actor_id);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, uuid, uuid) TO service_role;

-- Product mutations and their snapshots share one transaction.
CREATE FUNCTION public.mutate_product_with_audit(
  operation_param text,
  product_data jsonb,
  product_id uuid,
  actor_id uuid
) RETURNS SETOF public.products
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  before_row public.products;
  after_row public.products;
  columns_sql text;
BEGIN
  -- Only the server supplies the actor, after session or API-key authentication.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     OR NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = actor_id) THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501';
  END IF;
  IF operation_param NOT IN ('INSERT', 'UPDATE', 'DELETE') OR operation_param IS NULL
     OR product_data IS NULL OR jsonb_typeof(product_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product mutation' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(product_data) AS k(name)
    WHERE name IN ('id', 'created_at', 'updated_at') OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.products'::regclass AND attname = k.name
        AND attnum > 0 AND NOT attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'Invalid product fields' USING ERRCODE = '22023';
  END IF;

  IF operation_param IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO before_row FROM public.products WHERE id = product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT string_agg(format('%I', name), ', ' ORDER BY name)
    INTO columns_sql FROM jsonb_object_keys(product_data) AS k(name);
  IF operation_param = 'INSERT' THEN
    IF columns_sql IS NULL THEN
      RAISE EXCEPTION 'Product fields required' USING ERRCODE = '22023';
    END IF;
    EXECUTE format(
      'INSERT INTO public.products (%s) SELECT %s FROM jsonb_populate_record(NULL::public.products, $1) RETURNING *',
      columns_sql, columns_sql
    ) INTO after_row USING product_data;
  ELSIF operation_param = 'UPDATE' THEN
    IF columns_sql IS NULL THEN
      UPDATE public.products SET updated_at = now() WHERE id = product_id RETURNING * INTO after_row;
    ELSE
      EXECUTE format(
        'UPDATE public.products SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.products, $1)) WHERE id = $2 RETURNING *',
        columns_sql, columns_sql
      ) INTO after_row USING product_data, product_id;
    END IF;
  ELSE
    DELETE FROM public.products WHERE id = product_id;
  END IF;

  INSERT INTO public.audit_log (table_name, operation, old_values, new_values, user_id, performed_by)
  VALUES (
    'products', operation_param,
    CASE WHEN operation_param <> 'INSERT' THEN to_jsonb(before_row) END,
    CASE WHEN operation_param <> 'DELETE' THEN to_jsonb(after_row) END,
    actor_id, actor_id
  );
  RETURN NEXT CASE WHEN operation_param = 'DELETE' THEN before_row ELSE after_row END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mutate_product_with_audit(text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_product_with_audit(text, jsonb, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_admin_actions(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    IF NOT (SELECT public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    IF retention_days IS NULL OR retention_days < 30 THEN
        RAISE EXCEPTION 'Retention period must be at least 30 days';
    END IF;

    DELETE FROM public.admin_actions
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Leave table statistics intact for autovacuum scheduling.
    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits(retention_hours INTEGER DEFAULT 24)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '60s'
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    IF NOT (SELECT public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    IF retention_hours IS NULL OR retention_hours < 1 THEN
        RAISE EXCEPTION 'Retention period must be at least 1 hour';
    END IF;

    DELETE FROM public.rate_limits
    WHERE window_start < NOW() - (retention_hours || ' hours')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cleanup_job_status()
RETURNS TABLE(jobname TEXT, schedule TEXT, command TEXT, active BOOLEAN, last_run TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT j.jobname, j.schedule, j.command, j.active,
        (SELECT MAX(r.start_time) FROM cron.job_run_details r WHERE r.jobid = j.jobid)
    FROM cron.job j
    WHERE j.jobname LIKE '%cleanup%'
    ORDER BY j.jobname;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_admin_actions(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_rate_limits(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cleanup_job_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_admin_actions(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cleanup_job_status() TO service_role;

-- Recorded payment funnel; totals cover the whole period, table covers the top 100 products.
CREATE OR REPLACE FUNCTION public.get_checkout_funnel(
  p_days integer DEFAULT 30,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND NOT COALESCE((SELECT public.is_admin()), false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Invalid funnel period' USING ERRCODE = '22023';
  END IF;

  WITH buckets AS (
    SELECT pt.product_id, pt.currency,
      CASE
        WHEN pt.status IN ('completed', 'refunded', 'partially_refunded', 'disputed') THEN 'paid'
        ELSE pt.status
      END AS bucket,
      count(*) AS attempts
    FROM public.payment_transactions pt
    WHERE pt.created_at >= now() - make_interval(days => p_days)
      AND pt.created_at <= now()
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.product_id, pt.currency, bucket
  ), per_product AS (
    SELECT product_id, sum(attempts) AS started,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'paid'), 0) AS paid,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'pending'), 0) AS pending,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'abandoned'), 0) AS abandoned
    FROM buckets
    GROUP BY product_id
  ), top_products AS (
    SELECT * FROM per_product ORDER BY started DESC, product_id LIMIT 100
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
      'started', COALESCE(sum(started), 0), 'paid', COALESCE(sum(paid), 0),
      'pending', COALESCE(sum(pending), 0), 'abandoned', COALESCE(sum(abandoned), 0)
    ) FROM per_product),
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productId', t.product_id, 'name', p.name,
      'started', t.started, 'paid', t.paid, 'pending', t.pending, 'abandoned', t.abandoned
    ) ORDER BY t.started DESC, t.product_id), '[]'::jsonb)
    FROM top_products t LEFT JOIN public.products p ON p.id = t.product_id)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) TO service_role;

-- Affiliate program.
-- Phase 1 affiliate accounting and work queue.
-- Related: supabase/tests/affiliates-phase1.sql

CREATE TABLE public.affiliate_programs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 hold_days integer NOT NULL DEFAULT 30 CHECK(hold_days BETWEEN 0 AND 3650),
 buffer_days integer NOT NULL DEFAULT 2 CHECK(buffer_days BETWEEN 0 AND 365),
 terms_version text NOT NULL, terms jsonb NOT NULL CHECK(jsonb_typeof(terms)='object'),
 thresholds jsonb NOT NULL DEFAULT '{"PLN":"10000"}' CHECK(jsonb_typeof(thresholds)='object')
);
CREATE TABLE public.affiliate_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 code text NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9_-]{3,40}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended','terminated')),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120), channel text CHECK(length(channel)<=500),
 accepted_terms_version text NOT NULL, accepted_at timestamptz NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.affiliate_program_versions (
 program_id uuid NOT NULL REFERENCES public.affiliate_programs(id), version bigint NOT NULL CHECK(version>0),
 enabled boolean NOT NULL, hold_days integer NOT NULL CHECK(hold_days BETWEEN 0 AND 3650),
 buffer_days integer NOT NULL CHECK(buffer_days BETWEEN 0 AND 365), terms_version text NOT NULL,
 terms jsonb NOT NULL, thresholds jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(program_id,version)
);
CREATE INDEX affiliate_program_time ON public.affiliate_program_versions(created_at DESC,version DESC);
CREATE INDEX affiliate_terms_history ON public.affiliate_program_versions(terms_version,created_at DESC);
CREATE TABLE public.affiliate_membership_events (
 member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id), version bigint NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('pending','approved','rejected','suspended','terminated')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(member_id,version)
);
CREATE INDEX affiliate_member_time ON public.affiliate_membership_events(member_id,created_at DESC,version DESC);
CREATE TABLE public.affiliate_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0), enabled boolean NOT NULL,
 percentage_bps integer CHECK(percentage_bps BETWEEN 0 AND 10000), fixed_minor bigint CHECK(fixed_minor>=0),
 currency text CHECK(currency ~ '^[A-Z]{3}$'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(product_id,revision),
 CHECK((percentage_bps IS NOT NULL AND fixed_minor IS NULL AND currency IS NULL)
 OR (percentage_bps IS NULL AND fixed_minor IS NOT NULL AND currency IS NOT NULL))
);
CREATE TABLE public.affiliate_coupon_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id), version bigint NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz, UNIQUE(coupon_id,version),
 CHECK(retired_at IS NULL OR retired_at>=created_at)
);
CREATE UNIQUE INDEX affiliate_coupon_owner ON public.affiliate_coupon_bindings(coupon_id) WHERE retired_at IS NULL;
CREATE TABLE public.affiliate_commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
 line_item_id uuid NOT NULL REFERENCES public.payment_line_items(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id), rule_id uuid NOT NULL REFERENCES public.affiliate_rules(id),
 binding_id uuid NOT NULL REFERENCES public.affiliate_coupon_bindings(id), livemode boolean NOT NULL,
 session_created_at timestamptz NOT NULL, paid_at timestamptz NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 base_minor bigint NOT NULL CHECK(base_minor>=0), accrued_minor bigint NOT NULL CHECK(accrued_minor BETWEEN 0 AND base_minor),
 self_referral boolean NOT NULL, is_refundable boolean NOT NULL,
 refund_period_days integer CHECK(refund_period_days BETWEEN 1 AND 365),
 hold_days integer NOT NULL CHECK(hold_days BETWEEN 0 AND 3650), buffer_days integer NOT NULL CHECK(buffer_days BETWEEN 0 AND 365),
 eligible_at timestamptz, observed_refunded_gross bigint NOT NULL CHECK(observed_refunded_gross>=0), observed_status text NOT NULL,
 dispute_seen boolean NOT NULL DEFAULT false, dispute_reviewed_at timestamptz, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(payment_id,line_item_id,livemode), CHECK(NOT self_referral OR accrued_minor=0),
 CHECK(NOT(is_refundable AND refund_period_days IS NULL) OR eligible_at IS NULL)
);
CREATE TABLE public.affiliate_payouts (
 livemode boolean NOT NULL DEFAULT true,
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), earnings_minor bigint NOT NULL CHECK(earnings_minor>0),
 status text NOT NULL CHECK(status IN ('reserved','paid','cancelled')), needs_review boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), cutoff timestamptz NOT NULL,
 payee_reference text NOT NULL, bank_reference text UNIQUE, invoice_reference text,
 bank_amount_minor bigint CHECK(bank_amount_minor>0), paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'paid' OR (bank_reference IS NOT NULL AND invoice_reference IS NOT NULL AND bank_amount_minor IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE UNIQUE INDEX affiliate_one_open_payout ON public.affiliate_payouts(member_id,currency,livemode) WHERE status='reserved';
CREATE TABLE public.affiliate_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES public.affiliate_memberships(id),
 commission_id uuid REFERENCES public.affiliate_commissions(id), payout_id uuid UNIQUE REFERENCES public.affiliate_payouts(id),
 kind text NOT NULL CHECK(kind IN ('accrual','reversal','restoration','settlement','manual_adjustment')),
 amount_minor bigint NOT NULL CHECK(amount_minor<>0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 economic_key text NOT NULL UNIQUE, reason text, evidence_reference text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='settlement' AND amount_minor<0 AND payout_id IS NOT NULL AND commission_id IS NULL)
 OR (kind IN ('accrual','reversal','restoration') AND commission_id IS NOT NULL AND payout_id IS NULL)
 OR (kind='manual_adjustment' AND commission_id IS NOT NULL AND payout_id IS NULL AND reason IS NOT NULL AND evidence_reference IS NOT NULL)),
 CHECK(kind NOT IN ('accrual','restoration') OR amount_minor>0), CHECK(kind<>'reversal' OR amount_minor<0)
);
CREATE UNIQUE INDEX affiliate_one_accrual ON public.affiliate_ledger(commission_id) WHERE kind='accrual';
CREATE TABLE public.affiliate_payout_allocations (
 payout_id uuid NOT NULL REFERENCES public.affiliate_payouts(id), entry_id uuid NOT NULL REFERENCES public.affiliate_ledger(id),
 released_at timestamptz, PRIMARY KEY(payout_id,entry_id)
);
CREATE UNIQUE INDEX affiliate_one_allocation ON public.affiliate_payout_allocations(entry_id) WHERE released_at IS NULL;
CREATE TABLE public.affiliate_work (
 payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'sync' CHECK(kind='sync'), requested_generation bigint NOT NULL DEFAULT 1,
 processed_generation bigint NOT NULL DEFAULT 0, dispute_seen boolean NOT NULL DEFAULT false,
 status text NOT NULL CHECK(status IN ('pending','leased','done','needs_review')), attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz, lease_token uuid, last_error_code text,
 CHECK(processed_generation>=0 AND requested_generation>=processed_generation), CHECK(attempts>=0)
);
CREATE INDEX affiliate_maturity ON public.affiliate_commissions(member_id,currency,eligible_at,id);
CREATE INDEX affiliate_ledger_balance ON public.affiliate_ledger(member_id,currency,created_at,id);
CREATE INDEX affiliate_work_due ON public.affiliate_work(next_attempt_at,payment_id) WHERE status IN ('pending','leased');

CREATE INDEX affiliate_binding_member ON public.affiliate_coupon_bindings(member_id);
CREATE INDEX affiliate_commission_line ON public.affiliate_commissions(line_item_id);
CREATE INDEX affiliate_commission_rule ON public.affiliate_commissions(rule_id);
CREATE INDEX affiliate_commission_binding ON public.affiliate_commissions(binding_id);
CREATE INDEX affiliate_payout_member ON public.affiliate_payouts(member_id,currency);
CREATE INDEX affiliate_ledger_commission ON public.affiliate_ledger(commission_id);
CREATE INDEX affiliate_allocation_entry ON public.affiliate_payout_allocations(entry_id);

CREATE FUNCTION public.affiliate_valid_reference(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT p_value IS NOT NULL AND length(btrim(p_value)) BETWEEN 1 AND 200 AND p_value !~ E'[\r\n]';
$$;
CREATE FUNCTION public.affiliate_valid_program(p_terms jsonb,p_thresholds jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 IF octet_length(p_terms::text)>32768 OR octet_length(p_thresholds::text)>32768
 OR jsonb_typeof(p_terms)<>'object' OR jsonb_typeof(p_thresholds)<>'object'
 OR NOT (p_terms ?& ARRAY['en','pl']) OR (p_terms - ARRAY['en','pl'])<>'{}'::jsonb
 OR jsonb_typeof(p_terms->'en')<>'string' OR jsonb_typeof(p_terms->'pl')<>'string'
 OR length(btrim(p_terms->>'en'))=0 OR length(btrim(p_terms->>'pl'))=0 THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_each(p_thresholds) t
 WHERE t.key !~ '^[A-Z]{3}$' OR jsonb_typeof(t.value)<>'string' OR t.value#>>'{}' !~ '^[1-9][0-9]{0,18}$'
 OR (t.value#>>'{}')::numeric>9223372036854775807);
END $$;
ALTER TABLE public.affiliate_programs ADD CHECK(public.affiliate_valid_program(terms,thresholds)),
 ADD CHECK(public.affiliate_valid_reference(terms_version));
ALTER TABLE public.affiliate_program_versions ADD CHECK(public.affiliate_valid_program(terms,thresholds)),
 ADD CHECK(public.affiliate_valid_reference(terms_version));
ALTER TABLE public.affiliate_commissions ADD CHECK(eligible_at IS NULL OR eligible_at>=paid_at+greatest(hold_days,
 CASE WHEN is_refundable THEN refund_period_days+buffer_days ELSE 0 END)*interval '1 day');
ALTER TABLE public.affiliate_memberships ADD CHECK(public.affiliate_valid_reference(accepted_terms_version));
ALTER TABLE public.affiliate_payouts ADD CHECK(public.affiliate_valid_reference(payee_reference)),
 ADD CHECK(bank_reference IS NULL OR public.affiliate_valid_reference(bank_reference)),
 ADD CHECK(invoice_reference IS NULL OR public.affiliate_valid_reference(invoice_reference));
ALTER TABLE public.affiliate_ledger ADD CHECK(length(economic_key) BETWEEN 1 AND 200),
 ADD CHECK(reason IS NULL OR public.affiliate_valid_reference(reason)),
 ADD CHECK(evidence_reference IS NULL OR public.affiliate_valid_reference(evidence_reference));
ALTER TABLE public.affiliate_work ADD CHECK(last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$'),
 ADD CHECK((status='leased')=(lease_token IS NOT NULL AND leased_until IS NOT NULL)),
 ADD CHECK(requested_generation>0 AND (status<>'done' OR requested_generation=processed_generation));

CREATE FUNCTION public.affiliate_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_actor IS NULL
 OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_actor)
 OR NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN
 RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.affiliate_audit(p_table text,p_old jsonb,p_new jsonb,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.audit_log(table_name,operation,old_values,new_values,performed_by)
 VALUES(p_table,CASE WHEN p_old IS NULL THEN 'INSERT' ELSE 'UPDATE' END,p_old,p_new,p_actor);
END $$;
CREATE FUNCTION public.affiliate_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Append only record' USING ERRCODE='23514'; END $$;
CREATE FUNCTION public.affiliate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_NAME='affiliate_coupon_bindings' THEN
  IF (to_jsonb(NEW)-'retired_at')<>(to_jsonb(OLD)-'retired_at') OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL THEN
   RAISE EXCEPTION 'Binding already fixed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_commissions' THEN
  IF (to_jsonb(NEW)-ARRAY['observed_refunded_gross','observed_status','dispute_seen','dispute_reviewed_at','hold_days','eligible_at','version'])
   <>(to_jsonb(OLD)-ARRAY['observed_refunded_gross','observed_status','dispute_seen','dispute_reviewed_at','hold_days','eligible_at','version'])
   OR NEW.hold_days<OLD.hold_days OR (OLD.dispute_seen AND NOT NEW.dispute_seen)
   OR (OLD.eligible_at IS NULL AND NEW.eligible_at IS NOT NULL)
   OR NEW.eligible_at<OLD.eligible_at OR (OLD.dispute_reviewed_at IS NOT NULL AND NEW.dispute_reviewed_at IS NULL) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Commission snapshot fixed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_work' THEN
  IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=OLD.payment_id)
   AND (OLD.status<>'done' OR OLD.requested_generation<>OLD.processed_generation OR OLD.dispute_seen) THEN
   RAISE EXCEPTION 'Work remains due' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_payout_allocations' THEN
  IF NEW.payout_id<>OLD.payout_id OR NEW.entry_id<>OLD.entry_id OR OLD.released_at IS NOT NULL
   OR NEW.released_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE id=NEW.payout_id AND status='cancelled') THEN
   RAISE EXCEPTION 'Allocation remains reserved' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_payouts' THEN
  IF OLD.status<>'reserved' OR (to_jsonb(NEW)-ARRAY['status','needs_review','version','bank_reference','invoice_reference','bank_amount_minor','paid_at'])
   <>(to_jsonb(OLD)-ARRAY['status','needs_review','version','bank_reference','invoice_reference','bank_amount_minor','paid_at']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Payout fixed' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION public.affiliate_binding_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.coupons WHERE id=NEW.coupon_id FOR UPDATE;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.affiliate_memberships WHERE id=NEW.member_id AND status='approved' AND user_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Approved member required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings b WHERE b.coupon_id=NEW.coupon_id AND b.id<>NEW.id
  AND tstzrange(b.created_at,b.retired_at,'[)') && tstzrange(NEW.created_at,NEW.retired_at,'[)')) THEN
  RAISE EXCEPTION 'Binding periods overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.affiliate_check_relations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; p public.affiliate_payouts; l public.affiliate_ledger; total numeric;
BEGIN
 IF TG_TABLE_NAME='affiliate_commissions' THEN
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM public.payment_line_items li JOIN public.affiliate_rules r ON r.id=c.rule_id
   JOIN public.affiliate_coupon_bindings b ON b.id=c.binding_id
   JOIN public.payment_transactions pt ON pt.id=c.payment_id
   WHERE li.id=c.line_item_id AND li.transaction_id=c.payment_id AND li.product_id=r.product_id
    AND upper(li.currency)=c.currency AND upper(pt.currency)=c.currency AND b.member_id=c.member_id) THEN
   RAISE EXCEPTION 'Commission references differ' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_ledger' THEN
  SELECT * INTO l FROM public.affiliate_ledger WHERE id=NEW.id;
  IF l.commission_id IS NOT NULL THEN
   SELECT * INTO c FROM public.affiliate_commissions WHERE id=l.commission_id;
   IF l.member_id<>c.member_id OR l.currency<>c.currency OR (l.kind='accrual' AND l.amount_minor<>c.accrued_minor) THEN RAISE EXCEPTION 'Entry references differ' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum(amount_minor),0) INTO total FROM public.affiliate_ledger WHERE commission_id=c.id AND kind<>'manual_adjustment';
   IF total<0 OR total>c.accrued_minor THEN RAISE EXCEPTION 'Automatic total outside commission' USING ERRCODE='23514'; END IF;
   IF c.dispute_seen AND (SELECT coalesce(sum(amount_minor),0) FROM public.affiliate_ledger WHERE commission_id=c.id AND kind='manual_adjustment')>c.accrued_minor THEN
    RAISE EXCEPTION 'Adjustment outside commission' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO p FROM public.affiliate_payouts WHERE id=l.payout_id;
   IF l.member_id<>p.member_id OR l.currency<>p.currency OR l.amount_minor<>-p.earnings_minor OR p.status<>'paid' THEN
    RAISE EXCEPTION 'Settlement differs' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='affiliate_payouts' THEN
  SELECT * INTO p FROM public.affiliate_payouts WHERE id=NEW.id;
 ELSE
  SELECT * INTO p FROM public.affiliate_payouts WHERE id=NEW.payout_id;
 END IF;
 IF p.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND (e.member_id<>p.member_id OR e.currency<>p.currency OR e.kind='settlement' OR NOT EXISTS(SELECT 1 FROM public.affiliate_commissions comm WHERE comm.id=e.commission_id AND comm.livemode=p.livemode)))
   OR (SELECT coalesce(sum(e.amount_minor),0) FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND a.released_at IS NULL)<>(CASE WHEN p.status='cancelled' THEN 0 ELSE p.earnings_minor END)
   OR (p.status='paid' AND NOT EXISTS(SELECT 1 FROM public.affiliate_ledger WHERE payout_id=p.id)) THEN
   RAISE EXCEPTION 'Payout allocation differs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.affiliate_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid; disputed boolean;
BEGIN
 IF TG_TABLE_NAME='coupon_redemptions' THEN
  pid:=NEW.transaction_id;
  IF NOT EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings WHERE coupon_id=NEW.coupon_id) THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.refunded_amount IS NOT DISTINCT FROM OLD.refunded_amount
    AND NEW.fulfillment_pending IS NOT DISTINCT FROM OLD.fulfillment_pending THEN RETURN NEW; END IF;
  pid:=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM public.coupon_redemptions r JOIN public.affiliate_coupon_bindings b ON b.coupon_id=r.coupon_id WHERE r.transaction_id=pid)
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=pid) THEN RETURN NEW; END IF;
 END IF;
 IF pid IS NULL THEN RETURN NEW; END IF;
 SELECT status='disputed' INTO disputed FROM public.payment_transactions WHERE id=pid;
 INSERT INTO public.affiliate_work(payment_id,status,dispute_seen) VALUES(pid,'pending',disputed)
 ON CONFLICT(payment_id) DO UPDATE SET requested_generation=public.affiliate_work.requested_generation+1,
  dispute_seen=public.affiliate_work.dispute_seen OR excluded.dispute_seen,
  status=CASE WHEN public.affiliate_work.status='leased' THEN 'leased' ELSE 'pending' END,next_attempt_at=now();
 UPDATE public.affiliate_payouts p SET needs_review=true,version=version+1
 WHERE p.status='reserved' AND NOT p.needs_review AND EXISTS(
  SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
  JOIN public.affiliate_commissions c ON c.id=l.commission_id
  WHERE a.payout_id=p.id AND c.payment_id=pid AND a.released_at IS NULL);
 RETURN NEW;
END $$;

CREATE FUNCTION public.affiliate_claim_work(p_limit integer DEFAULT 25) RETURNS SETOF public.affiliate_work
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH due AS (
 SELECT payment_id FROM public.affiliate_work WHERE
 (status='pending' AND next_attempt_at<=now()) OR (status='leased' AND leased_until<=now())
 ORDER BY next_attempt_at,payment_id FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE public.affiliate_work w SET status='leased',lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempts=attempts+1
 FROM due WHERE w.payment_id=due.payment_id RETURNING w.*;
END $$;
CREATE FUNCTION public.affiliate_retry_work(p_payment uuid,p_token uuid,p_generation bigint,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.affiliate_work SET status=CASE WHEN attempts>=10 THEN 'needs_review' ELSE 'pending' END,
 next_attempt_at=now()+least(3600,60*power(2,least(attempts-1,6))) * interval '1 second',
 lease_token=NULL,leased_until=NULL,last_error_code=p_error
 WHERE payment_id=p_payment AND lease_token=p_token AND status='leased' AND leased_until>now()
 AND p_generation<=requested_generation AND p_generation>processed_generation;
 RETURN FOUND;
END $$;

CREATE FUNCTION public.affiliate_complete_unbound_work(p_payment uuid,p_token uuid,p_generation bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.payment_transactions WHERE id=p_payment FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.coupon_redemptions r JOIN public.affiliate_coupon_bindings b ON b.coupon_id=r.coupon_id WHERE r.transaction_id=p_payment)
  OR EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment) THEN RETURN false; END IF;
 UPDATE public.affiliate_work SET processed_generation=p_generation,
  status=CASE WHEN requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  lease_token=NULL,leased_until=NULL,last_error_code=NULL,attempts=0,next_attempt_at=now()
 WHERE payment_id=p_payment AND status='leased' AND lease_token=p_token AND leased_until>now()
  AND p_generation>processed_generation AND p_generation<=requested_generation;
 RETURN FOUND;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_complete_unbound_work(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_complete_unbound_work(uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.affiliate_apply_sync(p_payment uuid,p_token uuid,p_generation bigint,p_session_created_at timestamptz,p_livemode boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pt public.payment_transactions; w public.affiliate_work; b public.affiliate_coupon_bindings;
 prog public.affiliate_programs; rule public.affiliate_rules;
 c public.affiliate_commissions; li record; red public.coupon_redemptions; member_status text;
 base bigint; earned bigint; target bigint; automatic numeric; loss bigint; delta bigint;
 self_match boolean; mature timestamptz; waiting boolean:=false; net_missing boolean:=false; blocked boolean:=false;
BEGIN
 SELECT * INTO pt FROM public.payment_transactions WHERE id=p_payment FOR UPDATE;
 SELECT * INTO w FROM public.affiliate_work WHERE payment_id=p_payment FOR UPDATE;
 IF w.payment_id IS NULL OR p_token IS NULL OR p_generation IS NULL OR w.status<>'leased' OR w.lease_token IS DISTINCT FROM p_token OR w.leased_until<=now()
  OR p_generation>w.requested_generation OR p_generation<=w.processed_generation THEN RETURN false; END IF;
 IF p_session_created_at IS NULL OR p_session_created_at>now() OR p_livemode IS NULL THEN
  RAISE EXCEPTION 'Session required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment
  AND (session_created_at<>p_session_created_at OR livemode<>p_livemode)) THEN
  RAISE EXCEPTION 'Session differs' USING ERRCODE='23514'; END IF;
 SELECT * INTO red FROM public.coupon_redemptions WHERE transaction_id=p_payment ORDER BY redeemed_at,id LIMIT 1;
 IF red.id IS NOT NULL THEN
  SELECT * INTO b FROM public.affiliate_coupon_bindings WHERE coupon_id=red.coupon_id
   AND created_at<=p_session_created_at AND (retired_at IS NULL OR retired_at>p_session_created_at) ORDER BY version DESC LIMIT 1;
 END IF;
 IF b.id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(b.member_id::text||upper(pt.currency),0));
  SELECT v.program_id,true,v.enabled,v.version,v.hold_days,v.buffer_days,v.terms_version,v.terms,v.thresholds
   INTO prog FROM public.affiliate_program_versions v WHERE v.created_at<=p_session_created_at
   ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
  SELECT e.status INTO member_status FROM public.affiliate_membership_events e
   WHERE e.member_id=b.member_id AND e.created_at<=p_session_created_at ORDER BY e.created_at DESC,e.version DESC LIMIT 1;
  IF prog.id IS NULL OR member_status IS NULL THEN
   UPDATE public.affiliate_work SET status='needs_review',lease_token=NULL,leased_until=NULL,last_error_code='history_unavailable'
    WHERE payment_id=p_payment;
   RETURN false;
  END IF;
 END IF;
 IF pt.amount<>trunc(pt.amount) OR coalesce(pt.refunded_amount,0)<>trunc(coalesce(pt.refunded_amount,0)) THEN
  RAISE EXCEPTION 'Integer amounts required' USING ERRCODE='23514'; END IF;
 -- Existing corrections remain processable while new lines await fulfillment.
 FOR c IN SELECT * FROM public.affiliate_commissions WHERE payment_id=p_payment ORDER BY member_id,currency,id FOR UPDATE LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(c.member_id::text||c.currency,0));
  blocked:=c.dispute_seen OR w.dispute_seen OR pt.status='disputed';
  loss:=CASE WHEN c.base_minor=0 THEN 0 ELSE round(c.base_minor::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
  target:=CASE WHEN blocked OR c.base_minor=0 THEN 0 ELSE greatest(0,c.accrued_minor-round(c.accrued_minor::numeric*loss/c.base_minor)::bigint) END;
  SELECT coalesce(sum(amount_minor),0) INTO automatic FROM public.affiliate_ledger WHERE commission_id=c.id AND kind<>'manual_adjustment';
  delta:=target-automatic;
  IF delta<>0 THEN
   INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
    VALUES(c.member_id,c.id,CASE WHEN delta>0 THEN 'restoration' ELSE 'reversal' END,delta,c.currency,'sync:'||c.id||':'||p_generation);
  END IF;
  UPDATE public.affiliate_commissions SET observed_refunded_gross=coalesce(pt.refunded_amount,0)::bigint,observed_status=pt.status,
   dispute_seen=blocked,version=version+1 WHERE id=c.id;
  PERFORM public.affiliate_audit('affiliate_commissions',to_jsonb(c),(SELECT to_jsonb(updated) FROM public.affiliate_commissions updated WHERE id=c.id),NULL);
 END LOOP;
 IF b.id IS NOT NULL AND prog.enabled AND member_status='approved' AND pt.status IN ('completed','refunded','disputed') THEN
  SELECT EXISTS(SELECT 1 FROM public.affiliate_memberships am JOIN auth.users u ON u.id=am.user_id
   WHERE am.id=b.member_id AND (u.id=pt.user_id OR lower(btrim(u.email))=lower(btrim(pt.customer_email)))) INTO self_match;
  waiting:=pt.fulfillment_pending;
  net_missing:=NOT waiting AND EXISTS(
   SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
   CROSS JOIN LATERAL (SELECT r.enabled,r.currency FROM public.affiliate_rules r
    WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
   WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.enabled
    AND (r.currency IS NULL OR r.currency=upper(l.currency)) AND l.net_amount IS NULL);
  IF NOT waiting AND NOT net_missing THEN
   FOR li IN SELECT l.*,p.is_refundable,p.refund_period_days,p.product_type FROM public.payment_line_items l
    JOIN public.products p ON p.id=l.product_id WHERE l.transaction_id=p_payment ORDER BY l.id LOOP
    IF li.product_type<>'one_time' THEN CONTINUE; END IF;
    SELECT * INTO rule FROM public.affiliate_rules WHERE product_id=li.product_id AND created_at<=p_session_created_at
     ORDER BY created_at DESC,revision DESC LIMIT 1;
    IF rule.id IS NULL OR NOT rule.enabled OR (rule.currency IS NOT NULL AND rule.currency<>upper(li.currency)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment AND line_item_id=li.id AND livemode=p_livemode) THEN CONTINUE; END IF;
    base:=li.net_amount;
    earned:=CASE WHEN self_match THEN 0 WHEN rule.percentage_bps IS NOT NULL THEN round(base::numeric*rule.percentage_bps/10000)::bigint ELSE least(base,rule.fixed_minor) END;
    mature:=CASE WHEN li.is_refundable AND li.refund_period_days IS NULL THEN NULL ELSE
     red.redeemed_at+greatest(prog.hold_days,CASE WHEN li.is_refundable THEN li.refund_period_days+prog.buffer_days ELSE 0 END)*interval '1 day' END;
    INSERT INTO public.affiliate_commissions(payment_id,line_item_id,member_id,rule_id,binding_id,livemode,session_created_at,paid_at,
     currency,base_minor,accrued_minor,self_referral,is_refundable,refund_period_days,hold_days,buffer_days,eligible_at,observed_refunded_gross,observed_status,dispute_seen)
    VALUES(p_payment,li.id,b.member_id,rule.id,b.id,p_livemode,p_session_created_at,red.redeemed_at,upper(li.currency),base,earned,self_match,
     li.is_refundable,li.refund_period_days,prog.hold_days,prog.buffer_days,mature,coalesce(pt.refunded_amount,0)::bigint,pt.status,w.dispute_seen OR pt.status='disputed') RETURNING * INTO c;
    PERFORM public.affiliate_audit('affiliate_commissions',NULL,to_jsonb(c),NULL);
    IF earned>0 THEN
     INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
     VALUES(c.member_id,c.id,'accrual',earned,c.currency,'accrual:'||c.id);
     loss:=CASE WHEN base=0 THEN 0 ELSE round(base::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
     target:=CASE WHEN c.dispute_seen THEN 0 ELSE greatest(0,earned-round(earned::numeric*loss/base)::bigint) END;
     IF target<earned THEN
      INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
      VALUES(c.member_id,c.id,'reversal',target-earned,c.currency,'sync:'||c.id||':'||p_generation);
     END IF;
    END IF;
   END LOOP;
  END IF;
 ELSIF b.id IS NOT NULL AND pt.status NOT IN ('completed','refunded','disputed') THEN waiting:=true;
 END IF;
 UPDATE public.affiliate_work SET processed_generation=CASE WHEN waiting OR net_missing THEN processed_generation ELSE p_generation END,
  status=CASE WHEN net_missing THEN 'needs_review' WHEN waiting OR requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  next_attempt_at=CASE WHEN waiting THEN now()+interval '1 minute' ELSE now() END,
  lease_token=NULL,leased_until=NULL,last_error_code=CASE WHEN net_missing THEN 'net_unavailable' WHEN waiting THEN 'awaiting_fulfillment' ELSE NULL END,
  attempts=CASE WHEN waiting OR net_missing THEN attempts ELSE 0 END
 WHERE payment_id=p_payment;
 RETURN NOT waiting AND NOT net_missing;
END $$;

CREATE FUNCTION public.affiliate_apply(p_user uuid,p_code text,p_display_name text,p_channel text,p_terms_version text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_memberships; prog public.affiliate_programs;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_user IS NULL
  OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_user)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF NOT prog.enabled OR prog.terms_version IS DISTINCT FROM p_terms_version THEN RAISE EXCEPTION 'Terms changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.affiliate_memberships(user_id,code,display_name,channel,accepted_terms_version,accepted_at)
 VALUES(p_user,p_code,p_display_name,p_channel,p_terms_version,now()) RETURNING * INTO result;
 INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
 PERFORM public.affiliate_audit('affiliate_memberships',NULL,to_jsonb(result),p_user);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_program_update(p_actor uuid,p_expected_version bigint,p_enabled boolean,p_terms_version text,p_terms jsonb,p_hold_days integer,p_buffer_days integer,p_thresholds jsonb)
RETURNS public.affiliate_programs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_programs; result public.affiliate_programs;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_programs FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.affiliate_program_versions WHERE terms_version=p_terms_version AND terms<>p_terms) THEN
  RAISE EXCEPTION 'Terms version changed' USING ERRCODE='PT409'; END IF;
 IF old.id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.affiliate_programs(enabled,terms_version,terms,hold_days,buffer_days,thresholds)
   VALUES(p_enabled,p_terms_version,p_terms,p_hold_days,p_buffer_days,p_thresholds) RETURNING * INTO result;
 ELSE
  IF old.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
  UPDATE public.affiliate_programs SET enabled=p_enabled,terms_version=p_terms_version,terms=p_terms,hold_days=p_hold_days,
   buffer_days=p_buffer_days,thresholds=p_thresholds,version=version+1 WHERE id=old.id RETURNING * INTO result;
 END IF;
 INSERT INTO public.affiliate_program_versions(program_id,version,enabled,hold_days,buffer_days,terms_version,terms,thresholds)
 VALUES(result.id,result.version,result.enabled,result.hold_days,result.buffer_days,result.terms_version,result.terms,result.thresholds);
 PERFORM public.affiliate_audit('affiliate_programs',CASE WHEN old.id IS NULL THEN NULL ELSE to_jsonb(old) END,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_member_update(p_actor uuid,p_member uuid,p_expected_version bigint,p_status text,p_reason text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_memberships; result public.affiliate_memberships;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 IF NOT public.affiliate_valid_reference(p_reason) THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.affiliate_memberships WHERE id=p_member FOR UPDATE;
 IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 UPDATE public.affiliate_memberships SET status=p_status,version=version+1 WHERE id=p_member RETURNING * INTO result;
 INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
 PERFORM public.affiliate_audit('affiliate_memberships',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_rule_create(p_actor uuid,p_product uuid,p_expected_revision integer,p_enabled boolean,p_percentage_bps integer,p_fixed_minor bigint,p_currency text)
RETURNS public.affiliate_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_rules; revision integer;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM 1 FROM public.products WHERE id=p_product AND product_type='one_time' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'One-time product required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(r.revision),0) INTO revision FROM public.affiliate_rules r WHERE product_id=p_product;
 IF revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Revision changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.affiliate_rules(product_id,revision,enabled,percentage_bps,fixed_minor,currency)
 VALUES(p_product,revision+1,p_enabled,p_percentage_bps,p_fixed_minor,p_currency) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_rules',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_coupon_bind(p_actor uuid,p_coupon uuid,p_member uuid,p_expected_version bigint)
RETURNS public.affiliate_coupon_bindings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_coupon_bindings; result public.affiliate_coupon_bindings; revision bigint;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM 1 FROM public.coupons WHERE id=p_coupon FOR UPDATE;
 PERFORM 1 FROM public.affiliate_memberships WHERE id=p_member AND status='approved' AND user_id IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Approved member required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(version),0) INTO revision FROM public.affiliate_coupon_bindings WHERE coupon_id=p_coupon;
 IF revision IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO old FROM public.affiliate_coupon_bindings WHERE coupon_id=p_coupon AND retired_at IS NULL;
 UPDATE public.affiliate_coupon_bindings SET retired_at=now() WHERE id=old.id;
 INSERT INTO public.affiliate_coupon_bindings(coupon_id,member_id,version) VALUES(p_coupon,p_member,revision+1) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_coupon_bindings',CASE WHEN old.id IS NULL THEN NULL ELSE to_jsonb(old) END,to_jsonb(result),p_actor);
 RETURN result;
END $$;

CREATE FUNCTION public.affiliate_lock_member(p_member uuid,p_currency text,p_payments uuid[] DEFAULT '{}',p_livemode boolean DEFAULT true) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE locked uuid[];
BEGIN
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO locked FROM (
  SELECT pt.id FROM public.payment_transactions pt WHERE pt.id=ANY(p_payments)
   OR EXISTS(SELECT 1 FROM public.affiliate_commissions c JOIN public.affiliate_work w ON w.payment_id=c.payment_id
    WHERE c.payment_id=pt.id AND c.member_id=p_member AND c.currency=p_currency AND c.livemode=p_livemode
     AND w.requested_generation>w.processed_generation)
  ORDER BY pt.id FOR UPDATE
 ) payments;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_member::text||p_currency,0));
 RETURN locked;
END $$;
CREATE FUNCTION public.affiliate_preview(p_member uuid,p_currency text,p_cutoff timestamptz,p_livemode boolean DEFAULT true)
RETURNS TABLE(member_version text,program_version text,earnings_minor text,debt_offset_minor text,payable_minor text,
 held_minor text,threshold_minor text,sync_required boolean,available boolean,entry_ids uuid[],
 accrued text,reversed text,paid text,reserved text,balance text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH facts AS MATERIALIZED (
  SELECT c.id,c.eligible_at,c.dispute_seen,c.dispute_reviewed_at,pt.status,
   (c.observed_status<>pt.status OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0)
    OR coalesce(w.status<>'done' OR w.requested_generation>w.processed_generation,false)) AS dirty,
   EXISTS(SELECT 1 FROM public.affiliate_ledger l WHERE l.commission_id=c.id AND l.kind='accrual' AND l.created_at<=p_cutoff) AS earned,
   EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN public.affiliate_payout_allocations a ON a.entry_id=l.id AND a.released_at IS NULL
    JOIN public.affiliate_payouts p ON p.id=a.payout_id AND p.status='paid' WHERE l.commission_id=c.id) AS previously_paid
  FROM public.affiliate_commissions c JOIN public.payment_transactions pt ON pt.id=c.payment_id
  LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
  WHERE c.member_id=p_member AND c.currency=p_currency AND c.livemode=p_livemode
 ), entries AS MATERIALIZED (
  SELECT l.id,l.commission_id,l.kind,l.amount_minor,p.status AS allocation_status,
   coalesce(a.entry_id IS NULL AND ((f.earned AND f.eligible_at<=p_cutoff
    AND ((NOT f.dispute_seen AND f.status<>'disputed') OR f.dispute_reviewed_at IS NOT NULL))
    OR (l.amount_minor<0 AND f.previously_paid)),false) AS selectable
  FROM public.affiliate_ledger l JOIN facts f ON f.id=l.commission_id
  LEFT JOIN public.affiliate_payout_allocations a ON a.entry_id=l.id AND a.released_at IS NULL
  LEFT JOIN public.affiliate_payouts p ON p.id=a.payout_id
 ), totals AS (
  SELECT coalesce(sum(amount_minor) FILTER(WHERE selectable AND amount_minor>0),0) AS earnings,
   -coalesce(sum(amount_minor) FILTER(WHERE selectable AND amount_minor<0),0) AS debt,
   coalesce(sum(amount_minor) FILTER(WHERE kind='accrual'),0) AS accrued,
   -coalesce(sum(amount_minor) FILTER(WHERE kind IN ('reversal','restoration')),0) AS reversed,
   coalesce(sum(amount_minor) FILTER(WHERE allocation_status='reserved'),0) AS reserved,
   coalesce(sum(amount_minor),0) AS balance,
   coalesce(array_agg(id ORDER BY id) FILTER(WHERE selectable),'{}'::uuid[]) AS ids
  FROM entries
 ), held AS (
  SELECT coalesce(sum(greatest(amount,0)),0) AS amount FROM (
   SELECT sum(amount_minor) AS amount FROM entries WHERE allocation_status IS NULL AND NOT selectable GROUP BY commission_id
  ) h
 ), settlements AS (
  SELECT -coalesce(sum(l.amount_minor),0) AS amount FROM public.affiliate_ledger l
  JOIN public.affiliate_payouts p ON p.id=l.payout_id WHERE l.member_id=p_member AND l.currency=p_currency AND p.livemode=p_livemode
 ), readiness AS (SELECT coalesce(bool_or(dirty),false) AS dirty FROM facts)
 SELECT m.version::text,p.version::text,t.earnings::text,t.debt::text,(t.earnings-t.debt)::text,h.amount::text,
  p.thresholds->>p_currency,r.dirty,
  m.status='approved' AND m.user_id IS NOT NULL AND p.enabled AND NOT r.dirty
   AND p_cutoff IS NOT NULL AND p_cutoff<=now() AND p.thresholds ? p_currency
   AND t.earnings-t.debt>0 AND t.earnings-t.debt>=(p.thresholds->>p_currency)::bigint
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_payouts ap WHERE ap.member_id=p_member AND ap.currency=p_currency AND ap.livemode=p_livemode AND ap.status='reserved'),
  t.ids,t.accrued::text,t.reversed::text,s.amount::text,t.reserved::text,(t.balance-s.amount)::text
 FROM public.affiliate_memberships m CROSS JOIN public.affiliate_programs p CROSS JOIN totals t
 CROSS JOIN held h CROSS JOIN settlements s CROSS JOIN readiness r WHERE m.id=p_member;
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_preview(uuid,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_preview(uuid,text,timestamptz,boolean) TO service_role;

CREATE INDEX affiliate_portal_page ON public.affiliate_commissions(member_id,paid_at DESC,id DESC);
CREATE FUNCTION public.affiliate_portal_page(p_member uuid,p_currency text DEFAULT NULL,p_cursor uuid DEFAULT NULL,p_limit integer DEFAULT 25,p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 WITH page AS MATERIALIZED (
  SELECT c.* FROM public.affiliate_commissions c WHERE c.member_id=p_member AND (p_currency IS NULL OR c.currency=p_currency)
   AND (p_cursor IS NULL OR (c.paid_at,c.id)<(SELECT own.paid_at,own.id FROM public.affiliate_commissions own
    WHERE own.id=p_cursor AND own.member_id=p_member AND (p_currency IS NULL OR own.currency=p_currency)))
  ORDER BY c.paid_at DESC,c.id DESC LIMIT p_limit+1
 ), rows AS (
  SELECT c.id,c.paid_at,jsonb_build_object('product',prod.name,'reference',c.id,'currency',c.currency,'paid_at',c.paid_at,
   'eligible_at',c.eligible_at,'accrued_minor',c.accrued_minor::text,'current_minor',l.current::text,'livemode',c.livemode,
   'status',CASE WHEN l.current<=0 THEN 'reversed' WHEN l.reserved THEN 'reserved' WHEN l.paid>=l.current THEN 'paid'
    WHEN c.eligible_at<=p_as_of AND ((NOT c.dispute_seen AND pt.status<>'disputed') OR c.dispute_reviewed_at IS NOT NULL) THEN 'eligible' ELSE 'held' END,
   'sync_pending',c.observed_status<>pt.status OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0)
    OR coalesce(w.status<>'done' OR w.requested_generation>w.processed_generation,false),
   'needs_review',coalesce(w.status='needs_review',false) OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL)) AS row
  FROM (SELECT * FROM page ORDER BY paid_at DESC,id DESC LIMIT p_limit) c
  JOIN public.affiliate_rules r ON r.id=c.rule_id JOIN public.products prod ON prod.id=r.product_id
  JOIN public.payment_transactions pt ON pt.id=c.payment_id LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
  CROSS JOIN LATERAL (
   SELECT coalesce(sum(e.amount_minor),0) AS current,coalesce(bool_or(p.status='reserved'),false) AS reserved,
    coalesce(sum(e.amount_minor) FILTER(WHERE p.status='paid'),0) AS paid
   FROM public.affiliate_ledger e LEFT JOIN public.affiliate_payout_allocations a ON a.entry_id=e.id AND a.released_at IS NULL
   LEFT JOIN public.affiliate_payouts p ON p.id=a.payout_id WHERE e.commission_id=c.id
  ) l
 ) SELECT jsonb_build_object('commissions',coalesce((SELECT jsonb_agg(row ORDER BY paid_at DESC,id DESC) FROM rows),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM rows ORDER BY paid_at,id LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_page(uuid,text,uuid,integer,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_page(uuid,text,uuid,integer,timestamptz) TO service_role;

CREATE FUNCTION public.affiliate_portal_summary(p_member uuid,p_as_of timestamptz,p_livemode boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH balances AS (
  SELECT c.currency,v.* FROM (SELECT DISTINCT currency FROM public.affiliate_commissions WHERE member_id=p_member AND livemode=p_livemode) c
  CROSS JOIN LATERAL public.affiliate_preview(p_member,c.currency,p_as_of,p_livemode) v
 ), bindings AS MATERIALIZED (
  SELECT b.coupon_id,c.code,c.is_active,c.allowed_product_ids FROM public.affiliate_coupon_bindings b
  JOIN public.coupons c ON c.id=b.coupon_id WHERE b.member_id=p_member AND b.retired_at IS NULL
 ), rules AS (
  SELECT DISTINCT ON (r.product_id) r.*,p.name FROM public.affiliate_rules r JOIN public.products p ON p.id=r.product_id
  WHERE p.is_active AND p.product_type='one_time' AND EXISTS(SELECT 1 FROM bindings b WHERE b.is_active
   AND (coalesce(jsonb_array_length(b.allowed_product_ids),0)=0 OR b.allowed_product_ids ? r.product_id::text))
  ORDER BY r.product_id,r.revision DESC
 ) SELECT jsonb_build_object(
  'balances',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'accrued',accrued,'reversed',reversed,'paid',paid,'reserved',reserved,
   'held',held_minor,'eligible',greatest(payable_minor::numeric,0)::text,'debt',greatest(-payable_minor::numeric,0)::text,'balance',balance) ORDER BY currency) FROM balances),'[]'::jsonb),
  'codes',coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'active',is_active) ORDER BY code) FROM bindings),'[]'::jsonb),
  'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('product',name,'percentage_bps',percentage_bps,'fixed_minor',fixed_minor::text,'currency',currency,'enabled',enabled) ORDER BY name) FROM rules),'[]'::jsonb),
  'sync_pending',EXISTS(SELECT 1 FROM balances WHERE sync_required),
  'needs_review',EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE member_id=p_member AND livemode=p_livemode AND needs_review)
   OR EXISTS(SELECT 1 FROM public.affiliate_commissions c LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
    WHERE c.member_id=p_member AND c.livemode=p_livemode AND (w.status='needs_review' OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL))))
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) TO service_role;

CREATE FUNCTION public.affiliate_reserve(p_actor uuid,p_member uuid,p_currency text,p_cutoff timestamptz,p_member_version bigint,p_program_version bigint,p_payee_reference text,p_livemode boolean DEFAULT true)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.affiliate_memberships; prog public.affiliate_programs; result public.affiliate_payouts; preview record; locked uuid[];
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO preview FROM public.affiliate_preview(p_member,p_currency,p_cutoff,p_livemode);
 locked:=public.affiliate_lock_member(p_member,p_currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
   WHERE l.id=ANY(preview.entry_ids)),p_livemode);

 SELECT * INTO m FROM public.affiliate_memberships WHERE id=p_member FOR SHARE;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF m.id IS NULL OR m.version IS DISTINCT FROM p_member_version OR prog.version IS DISTINCT FROM p_program_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_livemode IS NULL OR m.status<>'approved' OR m.user_id IS NULL OR NOT prog.enabled OR p_currency !~ '^[A-Z]{3}$'
  OR p_cutoff IS NULL OR p_cutoff>now() OR NOT(prog.thresholds ? p_currency) THEN
  RAISE EXCEPTION 'Payout unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO preview FROM public.affiliate_preview(p_member,p_currency,p_cutoff,p_livemode);
 IF preview.sync_required OR EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
  WHERE l.id=ANY(preview.entry_ids) AND NOT(c.payment_id=ANY(locked))) THEN RAISE EXCEPTION 'Sync required' USING ERRCODE='PT409'; END IF;
 IF NOT preview.available THEN RAISE EXCEPTION 'Threshold not met' USING ERRCODE='22023'; END IF;
 INSERT INTO public.affiliate_payouts(member_id,currency,earnings_minor,status,cutoff,payee_reference,livemode)
  VALUES(p_member,p_currency,preview.payable_minor::bigint,'reserved',p_cutoff,p_payee_reference,p_livemode) RETURNING * INTO result;
 INSERT INTO public.affiliate_payout_allocations(payout_id,entry_id) SELECT result.id,unnest(preview.entry_ids);
 PERFORM public.affiliate_audit('affiliate_payouts',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_mark_paid(p_actor uuid,p_payout uuid,p_expected_version bigint,p_bank_reference text,p_invoice_reference text,
 p_bank_amount_minor bigint,p_currency text,p_paid_at timestamptz,p_full_settlement boolean,p_reason text DEFAULT NULL,p_evidence_reference text DEFAULT NULL,p_livemode boolean DEFAULT true)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_payouts; result public.affiliate_payouts;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout;
 PERFORM public.affiliate_lock_member(old.member_id,old.currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
   JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE a.payout_id=old.id AND a.released_at IS NULL),old.livemode);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout FOR UPDATE;
 IF old.livemode IS DISTINCT FROM p_livemode THEN RAISE EXCEPTION 'Stripe mode changed' USING ERRCODE='PT409'; END IF;
 IF old.status='paid' AND old.bank_reference=p_bank_reference AND old.invoice_reference=p_invoice_reference
  AND old.bank_amount_minor=p_bank_amount_minor AND old.currency=p_currency AND old.paid_at=p_paid_at AND p_full_settlement THEN RETURN old; END IF;
 IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected_version OR old.status<>'reserved' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_full_settlement IS DISTINCT FROM true OR p_currency IS DISTINCT FROM old.currency OR p_paid_at IS NULL OR p_paid_at>now()
 OR NOT public.affiliate_valid_reference(p_bank_reference) OR NOT public.affiliate_valid_reference(p_invoice_reference)
 OR p_bank_amount_minor IS NULL OR p_bank_amount_minor<=0
 OR (old.needs_review AND (NOT public.affiliate_valid_reference(p_reason) OR NOT public.affiliate_valid_reference(p_evidence_reference))) THEN
  RAISE EXCEPTION 'Payment evidence required' USING ERRCODE='22023'; END IF;
 UPDATE public.affiliate_payouts SET status='paid',version=version+1,bank_reference=p_bank_reference,
  invoice_reference=p_invoice_reference,bank_amount_minor=p_bank_amount_minor,paid_at=p_paid_at WHERE id=p_payout RETURNING * INTO result;
 INSERT INTO public.affiliate_ledger(member_id,payout_id,kind,amount_minor,currency,economic_key,reason,evidence_reference)
  VALUES(old.member_id,old.id,'settlement',-old.earnings_minor,old.currency,'settlement:'||old.id,p_reason,p_evidence_reference);
 PERFORM public.affiliate_audit('affiliate_payouts',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason,'evidence_reference',p_evidence_reference),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_cancel_payout(p_actor uuid,p_payout uuid,p_expected_version bigint,p_no_transfer boolean,p_reason text)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_payouts; result public.affiliate_payouts;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout;
 PERFORM public.affiliate_lock_member(old.member_id,old.currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
   JOIN public.affiliate_commissions c ON c.id=l.commission_id WHERE a.payout_id=old.id AND a.released_at IS NULL),old.livemode);
 SELECT * INTO old FROM public.affiliate_payouts WHERE id=p_payout FOR UPDATE;
 IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected_version OR old.status<>'reserved' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_no_transfer IS DISTINCT FROM true OR NOT public.affiliate_valid_reference(p_reason) THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='22023'; END IF;
 UPDATE public.affiliate_payouts SET status='cancelled',version=version+1 WHERE id=p_payout RETURNING * INTO result;
 UPDATE public.affiliate_payout_allocations SET released_at=now() WHERE payout_id=p_payout AND released_at IS NULL;
 PERFORM public.affiliate_audit('affiliate_payouts',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_manual_adjustment(p_actor uuid,p_commission uuid,p_expected_version bigint,p_amount_minor bigint,p_reason text,p_evidence_reference text,p_review_dispute boolean)
RETURNS public.affiliate_ledger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; result public.affiliate_ledger; total numeric;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO c FROM public.affiliate_commissions WHERE id=p_commission;
 PERFORM public.affiliate_lock_member(c.member_id,c.currency,ARRAY[c.payment_id],c.livemode);
 SELECT * INTO c FROM public.affiliate_commissions WHERE id=p_commission FOR UPDATE;
 IF c.id IS NULL OR c.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_amount_minor IS NULL OR p_amount_minor=0 OR NOT public.affiliate_valid_reference(p_reason) OR NOT public.affiliate_valid_reference(p_evidence_reference) THEN
  RAISE EXCEPTION 'Evidence required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(amount_minor),0)+p_amount_minor INTO total FROM public.affiliate_ledger WHERE commission_id=c.id;
 IF total<0 OR total>c.accrued_minor OR (p_review_dispute AND NOT c.dispute_seen)
  OR EXISTS(SELECT 1 FROM public.affiliate_work WHERE payment_id=c.payment_id AND requested_generation>processed_generation) THEN
  RAISE EXCEPTION 'Adjustment unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key,reason,evidence_reference)
 VALUES(c.member_id,c.id,'manual_adjustment',p_amount_minor,c.currency,'manual:'||c.id||':'||c.version,p_reason,p_evidence_reference) RETURNING * INTO result;
 UPDATE public.affiliate_commissions SET dispute_reviewed_at=CASE WHEN p_review_dispute THEN now() ELSE dispute_reviewed_at END,version=version+1 WHERE id=c.id;
 UPDATE public.affiliate_payouts p SET needs_review=true,version=version+1
 WHERE p.status='reserved' AND NOT p.needs_review AND EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a
  JOIN public.affiliate_ledger l ON l.id=a.entry_id WHERE a.payout_id=p.id AND a.released_at IS NULL AND l.commission_id=c.id);
 PERFORM public.affiliate_audit('affiliate_ledger',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
CREATE FUNCTION public.affiliate_work_retry(p_actor uuid,p_payment uuid,p_generation bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_work; result public.affiliate_work;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 IF NOT public.affiliate_valid_reference(p_reason) THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.affiliate_work WHERE payment_id=p_payment FOR UPDATE;
 IF old.payment_id IS NULL OR old.requested_generation IS DISTINCT FROM p_generation OR old.status='leased' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 UPDATE public.affiliate_work SET status='pending',attempts=0,next_attempt_at=now(),last_error_code=NULL,
 requested_generation=requested_generation+1 WHERE payment_id=p_payment RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_work',to_jsonb(old),to_jsonb(result)||jsonb_build_object('reason',p_reason),p_actor);
END $$;

CREATE TRIGGER affiliate_rules_guard BEFORE UPDATE OR DELETE ON public.affiliate_rules FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();

CREATE TRIGGER affiliate_ledger_guard BEFORE UPDATE OR DELETE ON public.affiliate_ledger FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();

CREATE TRIGGER affiliate_coupon_bindings_guard BEFORE UPDATE ON public.affiliate_coupon_bindings FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_commissions_guard BEFORE UPDATE ON public.affiliate_commissions FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_payouts_guard BEFORE UPDATE ON public.affiliate_payouts FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_payout_allocations_guard BEFORE UPDATE ON public.affiliate_payout_allocations FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();

CREATE TRIGGER affiliate_work_guard BEFORE DELETE ON public.affiliate_work FOR EACH ROW EXECUTE FUNCTION public.affiliate_guard();
CREATE CONSTRAINT TRIGGER affiliate_commissions_relations AFTER INSERT OR UPDATE ON public.affiliate_commissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE CONSTRAINT TRIGGER affiliate_ledger_relations AFTER INSERT OR UPDATE ON public.affiliate_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE CONSTRAINT TRIGGER affiliate_payouts_relations AFTER INSERT OR UPDATE ON public.affiliate_payouts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE CONSTRAINT TRIGGER affiliate_payout_allocations_relations AFTER INSERT OR UPDATE ON public.affiliate_payout_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.affiliate_check_relations();
CREATE TRIGGER affiliate_redemption_enqueue AFTER INSERT ON public.coupon_redemptions FOR EACH ROW EXECUTE FUNCTION public.affiliate_enqueue();
CREATE TRIGGER affiliate_payment_enqueue AFTER UPDATE OF status,refunded_amount,fulfillment_pending ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.affiliate_enqueue();

ALTER TABLE public.affiliate_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_programs_service ON public.affiliate_programs FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_programs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_programs TO service_role;

ALTER TABLE public.affiliate_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_memberships_service ON public.affiliate_memberships FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_memberships FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_memberships TO service_role;

ALTER TABLE public.affiliate_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_rules_service ON public.affiliate_rules FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_rules FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_rules TO service_role;

ALTER TABLE public.affiliate_coupon_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_coupon_bindings_service ON public.affiliate_coupon_bindings FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_coupon_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_coupon_bindings TO service_role;

ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_commissions_service ON public.affiliate_commissions FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_commissions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_commissions TO service_role;

ALTER TABLE public.affiliate_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_payouts_service ON public.affiliate_payouts FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_payouts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_payouts TO service_role;

ALTER TABLE public.affiliate_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_ledger_service ON public.affiliate_ledger FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_ledger FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_ledger TO service_role;

ALTER TABLE public.affiliate_payout_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_payout_allocations_service ON public.affiliate_payout_allocations FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_payout_allocations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.affiliate_payout_allocations TO service_role;

ALTER TABLE public.affiliate_work ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_work_service ON public.affiliate_work FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.affiliate_work TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_valid_reference(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_valid_reference(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_valid_program(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_valid_program(jsonb,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_admin(uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_audit(text,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_immutable() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_guard() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_check_relations() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_enqueue() FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_claim_work(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_claim_work(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_retry_work(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_retry_work(uuid,uuid,bigint,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_program_update(uuid,bigint,boolean,text,jsonb,integer,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_program_update(uuid,bigint,boolean,text,jsonb,integer,integer,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_member_update(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_member_update(uuid,uuid,bigint,text,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_rule_create(uuid,uuid,integer,boolean,integer,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_rule_create(uuid,uuid,integer,boolean,integer,bigint,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_coupon_bind(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_coupon_bind(uuid,uuid,uuid,bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_lock_member(uuid,text,uuid[],boolean) FROM PUBLIC,anon,authenticated,service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_mark_paid(uuid,uuid,bigint,text,text,bigint,text,timestamptz,boolean,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_mark_paid(uuid,uuid,bigint,text,text,bigint,text,timestamptz,boolean,text,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_cancel_payout(uuid,uuid,bigint,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_cancel_payout(uuid,uuid,bigint,boolean,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_manual_adjustment(uuid,uuid,bigint,bigint,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_manual_adjustment(uuid,uuid,bigint,bigint,text,text,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.affiliate_work_retry(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_work_retry(uuid,uuid,bigint,text) TO service_role;

CREATE TRIGGER affiliate_binding_period BEFORE INSERT OR UPDATE ON public.affiliate_coupon_bindings
FOR EACH ROW EXECUTE FUNCTION public.affiliate_binding_check();
REVOKE EXECUTE ON FUNCTION public.affiliate_binding_check() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER affiliate_program_versions_guard BEFORE UPDATE OR DELETE ON public.affiliate_program_versions
 FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();
CREATE TRIGGER affiliate_membership_events_guard BEFORE UPDATE OR DELETE ON public.affiliate_membership_events
 FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();
ALTER TABLE public.affiliate_program_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_program_versions_service ON public.affiliate_program_versions FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_program_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_program_versions TO service_role;
ALTER TABLE public.affiliate_membership_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_membership_events_service ON public.affiliate_membership_events FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
REVOKE ALL ON public.affiliate_membership_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.affiliate_membership_events TO service_role;

-- Stripe minor-unit factor per currency: zero-decimal currencies (JPY, KRW, VND, ...) are
-- charged in whole units, everything else in hundredths. Twin of lib/currency/minor-units.ts.
CREATE OR REPLACE FUNCTION public.currency_minor_factor(currency_code TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE WHEN upper(currency_code) IN
    ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','VND','VUV','XAF','XOF','XPF')
    THEN 1::numeric ELSE 100::numeric END;
$$;

-- Payment completion validates the amount Stripe reports (minor units) against product prices
-- (major units) using the currency's minor-unit factor instead of a fixed 100.
CREATE OR REPLACE FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL,
  amount_subtotal_param NUMERIC DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  pi_param TEXT := stripe_payment_intent_id;
  current_user_id UUID;
  product_record RECORD;
  existing_user_id UUID;
  access_expires_at TIMESTAMPTZ := NULL;
  transaction_id_var UUID;
  pending_transaction_id UUID;
  bump_rec RECORD;
  total_bump_price NUMERIC := 0;
  bump_count INTEGER := 0;
  bump_ids_found UUID[] := '{}';
  main_line_item_price NUMERIC := 0;
  effective_unit_price NUMERIC := 0;
  existing_transaction_id UUID;
  caller_email TEXT;
  charge_basis NUMERIC := 0;  -- net for net-priced products, else gross
  minor_factor NUMERIC := public.currency_minor_factor(currency_param);  -- 100, or 1 for zero-decimal currencies
BEGIN
  IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded');
  END IF;

  IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
  END IF;

  IF NOT (session_id_param ~* '^(cs_|pi_)[a-zA-Z0-9_]+$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID format');
  END IF;

  IF product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product ID is required');
  END IF;

  IF NOT public.validate_email_format(customer_email_param) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid email address is required');
  END IF;

  IF amount_total IS NULL OR amount_total <= 0 OR amount_total > 99999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF user_id_param IS NOT NULL THEN
    IF (select auth.role()) = 'service_role' THEN
      current_user_id := user_id_param;
    ELSIF auth.uid() = user_id_param THEN
      current_user_id := user_id_param;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
  ELSE
    current_user_id := NULL;
  END IF;

  IF current_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = current_user_id AND email_confirmed_at IS NOT NULL
  ) THEN
    current_user_id := NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    IF current_user_id IS NOT NULL THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = current_user_id AND email_confirmed_at IS NOT NULL;
      IF caller_email IS NOT NULL AND lower(caller_email) = lower(customer_email_param) THEN
        SELECT id INTO existing_transaction_id
        FROM public.payment_transactions
        WHERE session_id = session_id_param
        LIMIT 1;

        IF EXISTS (
          SELECT 1 FROM public.guest_purchases
          WHERE session_id = session_id_param AND claimed_by_user_id IS NULL
        ) THEN
          PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

          FOR bump_rec IN
            SELECT pli.product_id, pli.access_duration_override
            FROM public.payment_line_items pli
            WHERE pli.transaction_id = existing_transaction_id
              AND pli.item_type = 'order_bump'
          LOOP
            PERFORM public.grant_product_access_service_role(
              current_user_id,
              bump_rec.product_id,
              override_duration_days_param => bump_rec.access_duration_override
            );
          END LOOP;

          UPDATE public.guest_purchases
          SET claimed_by_user_id = current_user_id,
              claimed_at = NOW()
          WHERE session_id = session_id_param;

          UPDATE public.payment_transactions
          SET user_id = current_user_id,
              updated_at = NOW()
          WHERE id = existing_transaction_id AND user_id IS NULL;

          RETURN jsonb_build_object(
            'success', true,
            'scenario', 'idempotent_claimed_for_logged_in_user',
            'access_granted', true,
            'is_guest_purchase', false,
            'send_magic_link', false,
            'requires_login', false,
            'customer_email', customer_email_param
          );
        END IF;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.guest_purchases WHERE session_id = session_id_param AND claimed_by_user_id IS NULL) THEN
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param,
        'message', 'Payment already processed (idempotent)'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'already_processed_idempotent',
        'access_granted', true,
        'already_had_access', true,
        'message', 'Payment already processed (idempotent)'
      );
    END IF;
  END IF;

  SELECT id, name, auto_grant_duration_days, price, currency, allow_custom_price, custom_price_min,
         sale_price, sale_price_until, sale_quantity_limit, sale_quantity_sold, price_includes_vat INTO product_record
  FROM public.products
  WHERE id = product_id_param AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  IF product_record.currency IS NOT NULL THEN
    IF upper(currency_param) != upper(product_record.currency) THEN
      RAISE EXCEPTION 'Currency mismatch: expected %, got %',
        product_record.currency, currency_param;
    END IF;
  END IF;

  effective_unit_price := CASE
    WHEN public.is_sale_price_active(
           product_record.sale_price,
           product_record.sale_price_until,
           product_record.sale_quantity_limit,
           product_record.sale_quantity_sold)
    THEN product_record.sale_price
    ELSE product_record.price
  END;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many bump products (max 20)');
  END IF;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 0 THEN
    FOR bump_rec IN
      SELECT
        p.id,
        p.name,
        ob.id as order_bump_id,
        COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as auto_grant_duration_days,
        COALESCE(ob.bump_price, p.price) as price,
        p.currency
      FROM unnest(bump_product_ids_param) AS bid(id)
      JOIN public.products p ON p.id = bid.id
      JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
      WHERE p.is_active = true
        AND ob.is_active = true
    LOOP
      total_bump_price := total_bump_price + bump_rec.price;
      bump_count := bump_count + 1;
      bump_ids_found := array_append(bump_ids_found, bump_rec.id);
    END LOOP;
  END IF;

  charge_basis := CASE
    WHEN COALESCE(product_record.price_includes_vat, false) = false
         AND amount_subtotal_param IS NOT NULL
    THEN amount_subtotal_param
    ELSE amount_total
  END;

  IF product_record.price IS NOT NULL THEN
    DECLARE
      expected_total NUMERIC;   -- full price + bumps (upper bound)
      effective_total NUMERIC;  -- effective (sale-aware) price + bumps (lower bound)
    BEGIN
      expected_total := product_record.price + total_bump_price;
      effective_total := effective_unit_price + total_bump_price;

      IF product_record.allow_custom_price = true THEN
        IF charge_basis < ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * minor_factor) THEN
          RAISE EXCEPTION 'Amount below minimum: got % (minor units), minimum is % (minor units)',
            charge_basis, ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * minor_factor);
        END IF;
      ELSIF coupon_id_param IS NULL THEN
        IF charge_basis < (effective_total * minor_factor) OR charge_basis > (expected_total * minor_factor) THEN
          RAISE EXCEPTION 'Amount mismatch: expected between % and % (minor units) (effective % + bumps %), got % (minor units)',
            (effective_total * minor_factor),
            (expected_total * minor_factor),
            (effective_unit_price * minor_factor),
            (total_bump_price * minor_factor),
            charge_basis;
        END IF;
      ELSE
        IF charge_basis <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF charge_basis > (expected_total * minor_factor) THEN
          RAISE EXCEPTION 'Amount too high with coupon: got % (minor units) but max possible is % (minor units)',
            charge_basis, (expected_total * minor_factor);
        END IF;
      END IF;
    END;
  END IF;

  IF product_record.allow_custom_price = true THEN
    main_line_item_price := (charge_basis / minor_factor) - total_bump_price;
    IF main_line_item_price < 0 THEN
      RAISE EXCEPTION 'Invalid PWYW line item amount: amount % (minor units) is lower than bump total %',
        charge_basis, total_bump_price;
    END IF;
  ELSE
    main_line_item_price := effective_unit_price;
  END IF;

  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param AND email_confirmed_at IS NOT NULL;

  IF product_record.auto_grant_duration_days IS NOT NULL THEN
    access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
  END IF;

  BEGIN
    IF current_user_id IS NULL AND existing_user_id IS NOT NULL THEN
      current_user_id := existing_user_id;
    END IF;

    SELECT pt.id INTO pending_transaction_id
    FROM public.payment_transactions pt
    WHERE (pt.stripe_payment_intent_id = pi_param OR pt.session_id = session_id_param)
      AND pt.status = 'pending'
    LIMIT 1;

    IF pending_transaction_id IS NOT NULL THEN
      UPDATE public.payment_transactions
      SET
        status = 'completed',
        fulfillment_pending = true,
        user_id = current_user_id,
        customer_email = customer_email_param,
        metadata = metadata || jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param,
          'converted_from_pending', true
        ),
        updated_at = NOW()
      WHERE id = pending_transaction_id
      RETURNING id INTO transaction_id_var;
    ELSE
      INSERT INTO public.payment_transactions (
        session_id, user_id, product_id, customer_email, amount, currency,
        stripe_payment_intent_id, status, fulfillment_pending, metadata
      ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param,
        amount_total, upper(currency_param), stripe_payment_intent_id, 'completed', true,
        jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param
        )
      ) RETURNING id INTO transaction_id_var;
    END IF;

    PERFORM public.increment_sale_quantity_sold(product_id_param);

    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price,
      currency, product_name
    ) VALUES (
      transaction_id_var, product_id_param, 'main_product', 1,
      main_line_item_price, main_line_item_price,
      upper(currency_param), product_record.name
    );

    IF bump_count > 0 THEN
      FOR bump_rec IN
        SELECT
          p.id,
          p.name,
          ob.id as order_bump_id,
          ob.access_duration_days as access_duration_override,
          COALESCE(ob.bump_price, p.price) as price,
          p.currency
        FROM unnest(bump_ids_found) AS bid(id)
        JOIN public.products p ON p.id = bid.id
        JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
        WHERE p.is_active = true AND ob.is_active = true
      LOOP
        INSERT INTO public.payment_line_items (
          transaction_id, product_id, item_type, quantity, unit_price, total_price,
          currency, product_name, order_bump_id, access_duration_override
        ) VALUES (
          transaction_id_var, bump_rec.id, 'order_bump', 1,
          bump_rec.price, bump_rec.price,
          upper(COALESCE(bump_rec.currency, currency_param)), bump_rec.name,
          bump_rec.order_bump_id, bump_rec.access_duration_override
        );
      END LOOP;
    END IF;

    IF coupon_id_param IS NOT NULL THEN
      DELETE FROM public.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE public.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO public.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

    IF current_user_id IS NOT NULL THEN
      PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

      IF bump_count > 0 THEN
        FOR bump_rec IN
          SELECT u.bid AS product_id, ob.access_duration_days AS access_duration_override
          FROM unnest(bump_ids_found) AS u(bid)
          JOIN public.order_bumps ob
            ON ob.bump_product_id = u.bid AND ob.main_product_id = product_id_param
        LOOP
          PERFORM public.grant_product_access_service_role(
            current_user_id,
            bump_rec.product_id,
            override_duration_days_param => bump_rec.access_duration_override
          );
        END LOOP;
      END IF;

      IF user_id_param IS NULL AND existing_user_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'scenario', 'guest_purchase_user_exists_with_bump',
          'access_granted', true,
          'is_guest_purchase', false,
          'send_magic_link', true,
          'requires_login', true,
          'bump_access_granted', bump_count > 0,
          'bump_count', bump_count,
          'customer_email', customer_email_param
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_count > 0,
        'bump_count', bump_count,
        'customer_email', customer_email_param
      );
    ELSE
      INSERT INTO public.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_process_stripe_payment_completion_with_bump_impl error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment processing failed. Please try again or contact support.',
      'code', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

