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
