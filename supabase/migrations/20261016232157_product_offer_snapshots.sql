-- Product-scoped offer presentation snapshots. @see supabase/tests/product-offers.sql
-- offer-schema:start
CREATE FUNCTION public.product_offer_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '{"type":"object","properties":{"format":{"type":"number","const":1},"enabled":{"type":"boolean"},"templateId":{"type":"string","const":"offer-default"},"settings":{"type":"object","properties":{"density":{"type":"string","enum":["comfortable","compact"]}},"required":["density"],"additionalProperties":false},"content":{"type":"object","properties":{"offer.hero":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"hero"},"eyebrow":{"type":"string","maxLength":80,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"steps":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}}},"required":["kind","eyebrow","heading","body","steps"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"offer.faq":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"faq"},"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,63}$"},"question":{"type":"string","maxLength":240,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"answer":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["id","question","answer"],"additionalProperties":false}}},"required":["kind","items"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]},"offer.closing":{"anyOf":[{"type":"object","properties":{"sourceLocale":{"type":"string","const":"en"},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","en"],"additionalProperties":false},{"type":"object","properties":{"sourceLocale":{"type":"string","const":"pl"},"pl":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false},"en":{"type":"object","properties":{"kind":{"type":"string","const":"cta"},"heading":{"type":"string","maxLength":160,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"},"body":{"type":"string","maxLength":4000,"pattern":"^(?![\\s\\S]*<[^>]*>)[\\s\\S]*$"}},"required":["kind","heading","body"],"additionalProperties":false}},"required":["sourceLocale","pl"],"additionalProperties":false}]}},"additionalProperties":false},"tokens":{"anyOf":[{"type":"object","properties":{"format":{"type":"number","const":1},"light":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"required":["background","foreground","accent","accentForeground","muted","mutedForeground","border"],"additionalProperties":false},"dark":{"type":"object","properties":{"background":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"foreground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accentForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"mutedForeground":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"border":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}},"required":["background","foreground","accent","accentForeground","muted","mutedForeground","border"],"additionalProperties":false},"typography":{"type":"object","properties":{"font":{"type":"string","enum":["geist","dm-sans"]},"bodyWeight":{"anyOf":[{"type":"number","const":400},{"type":"number","const":500}]},"headingWeight":{"anyOf":[{"type":"number","const":500},{"type":"number","const":600},{"type":"number","const":700}]},"baseSizePx":{"anyOf":[{"type":"number","const":16},{"type":"number","const":17},{"type":"number","const":18}]},"headingLetterSpacingEm":{"anyOf":[{"type":"number","const":-0.02},{"type":"number","const":-0.01},{"type":"number","const":0}]}},"required":["font","bodyWeight","headingWeight","baseSizePx","headingLetterSpacingEm"],"additionalProperties":false},"shapes":{"type":"object","properties":{"radiusSmPx":{"anyOf":[{"type":"number","const":0},{"type":"number","const":4},{"type":"number","const":8}]},"radiusMdPx":{"anyOf":[{"type":"number","const":4},{"type":"number","const":8},{"type":"number","const":12}]},"radiusLgPx":{"anyOf":[{"type":"number","const":8},{"type":"number","const":12},{"type":"number","const":16},{"type":"number","const":24}]}},"required":["radiusSmPx","radiusMdPx","radiusLgPx"],"additionalProperties":false}},"required":["format","light","dark","typography","shapes"],"additionalProperties":false},{"type":"null"}]}},"required":["format","enabled","templateId","settings","content","tokens"],"additionalProperties":false}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.product_offer_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_offer_config_schema() TO service_role;
-- offer-schema:end

CREATE FUNCTION public.product_offer_config_valid(config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.jsonschema_subset_matches(public.product_offer_config_schema(), config) IS DISTINCT FROM true THEN RETURN false; END IF;
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
REVOKE EXECUTE ON FUNCTION public.product_offer_config_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_offer_config_valid(jsonb) TO service_role;

CREATE TABLE public.product_offer_config (
 product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
 draft jsonb,
 published jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 CHECK (draft IS NULL OR (octet_length(draft::text) <= 102400 AND public.product_offer_config_valid(draft))),
 CHECK (published IS NULL OR (octet_length(published::text) <= 102400 AND public.product_offer_config_valid(published)))
);
CREATE TABLE public.product_offer_history (
 product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
 operation text NOT NULL CHECK (operation IN ('draft','publish','rollback','reset')),
 draft jsonb,
 published jsonb,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 restored_from bigint CHECK (restored_from BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY (product_id,revision),
 FOREIGN KEY (product_id,restored_from) REFERENCES public.product_offer_history(product_id,revision) ON DELETE NO ACTION,
 CHECK (draft IS NULL OR (octet_length(draft::text) <= 102400 AND public.product_offer_config_valid(draft))),
 CHECK (published IS NULL OR (octet_length(published::text) <= 102400 AND public.product_offer_config_valid(published)))
);
CREATE INDEX product_offer_updated_by ON public.product_offer_config(updated_by);
CREATE INDEX product_offer_history_actor ON public.product_offer_history(actor_id);
CREATE INDEX product_offer_history_restored ON public.product_offer_history(product_id,restored_from);
ALTER TABLE public.product_offer_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_offer_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY offer_config_admin_read ON public.product_offer_config FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY offer_history_admin_read ON public.product_offer_history FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY offer_config_service ON public.product_offer_config FOR ALL TO service_role
 USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY offer_history_service_read ON public.product_offer_history FOR SELECT TO service_role USING ((select auth.role()) = 'service_role');
CREATE POLICY offer_history_service_insert ON public.product_offer_history FOR INSERT TO service_role WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.product_offer_config FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.product_offer_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.product_offer_config TO authenticated;
GRANT SELECT ON public.product_offer_history TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.product_offer_config TO service_role;
GRANT SELECT,INSERT ON public.product_offer_history TO service_role;
