-- Product bundles: a bundle is a product (is_bundle=true) linked to component products via
-- bundle_items (many-to-many). Single migration file per project rule (last release = v2026.6.16).
-- Components are granted on purchase via grant_product_and_bundle_components (shared by the
-- completion RPC and guest-claim; also future-proofs a cart).

SET client_min_messages = warning;

-- 1) Bundle flag on products ---------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false;

-- 2) Components join table ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bundle_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  display_order        INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_product_id, component_product_id),
  CHECK (bundle_product_id <> component_product_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON public.bundle_items (bundle_product_id, display_order);
CREATE INDEX IF NOT EXISTS idx_bundle_items_component ON public.bundle_items (component_product_id);

-- 3) Validation trigger: parent is a bundle, component is a non-bundle one_time product -----------
CREATE OR REPLACE FUNCTION public.validate_bundle_item()
RETURNS TRIGGER AS $$
DECLARE
  parent_is_bundle BOOLEAN;
  child_is_bundle  BOOLEAN;
  child_type       TEXT;
BEGIN
  SELECT is_bundle INTO parent_is_bundle FROM public.products WHERE id = NEW.bundle_product_id;
  SELECT is_bundle, product_type INTO child_is_bundle, child_type FROM public.products WHERE id = NEW.component_product_id;

  IF parent_is_bundle IS NOT TRUE THEN
    RAISE EXCEPTION 'bundle_product_id % is not a bundle (is_bundle=true required)', NEW.bundle_product_id;
  END IF;
  IF child_is_bundle IS TRUE THEN
    RAISE EXCEPTION 'nested bundles are not allowed: component % is itself a bundle', NEW.component_product_id;
  END IF;
  IF COALESCE(child_type, 'one_time') <> 'one_time' THEN
    RAISE EXCEPTION 'subscription products cannot be bundle components (component %)', NEW.component_product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS validate_bundle_item_trigger ON public.bundle_items;
CREATE TRIGGER validate_bundle_item_trigger
  BEFORE INSERT OR UPDATE ON public.bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_bundle_item();

-- 4) RLS: service-role writes; public read of a bundle's components (for the offer page) ----------
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bundle_items service role" ON public.bundle_items;
CREATE POLICY "bundle_items service role" ON public.bundle_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "bundle_items public read" ON public.bundle_items;
CREATE POLICY "bundle_items public read" ON public.bundle_items
  FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.bundle_items FROM anon, authenticated;
GRANT SELECT ON public.bundle_items TO anon, authenticated;
GRANT ALL ON public.bundle_items TO service_role;

-- 5) Shared grant primitive: grant the product + (if bundle) each component ------------------------
CREATE OR REPLACE FUNCTION public.grant_product_and_bundle_components(
  user_id_param UUID,
  product_id_param UUID,
  override_duration_days_param INTEGER DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  is_bundle_var BOOLEAN;
  comp_rec RECORD;
  granted INTEGER := 0;
BEGIN
  PERFORM public.grant_product_access_service_role(
    user_id_param, product_id_param, override_duration_days_param => override_duration_days_param
  );
  granted := granted + 1;

  SELECT is_bundle INTO is_bundle_var FROM public.products WHERE id = product_id_param;
  IF is_bundle_var IS TRUE THEN
    FOR comp_rec IN
      SELECT component_product_id FROM public.bundle_items
      WHERE bundle_product_id = product_id_param
      ORDER BY display_order
    LOOP
      BEGIN
        PERFORM public.grant_product_access_service_role(user_id_param, comp_rec.component_product_id);
        granted := granted + 1;
      EXCEPTION WHEN OTHERS THEN
        PERFORM public.log_admin_action(
          'bundle_component_grant_failure', 'bundle_items', product_id_param::TEXT,
          jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
            'component_product_id', comp_rec.component_product_id,
            'function_name', 'grant_product_and_bundle_components')
        );
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'granted', granted);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.grant_product_and_bundle_components(UUID, UUID, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_product_and_bundle_components(UUID, UUID, INTEGER) TO service_role;
