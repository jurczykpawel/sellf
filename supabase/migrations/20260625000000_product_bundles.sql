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

-- 5) Component grant helper: idempotent grant of a bundle COMPONENT, regardless of is_active ------
-- A buyer who paid for a bundle must receive every component. is_active governs whether a product
-- can be sold STANDALONE — it does not govern bundle membership. The shared
-- grant_product_access_service_role filters on is_active = true (correct for its callers: the payment
-- completion RPC and order bumps), so it would silently skip an inactive component. This helper
-- mirrors that function's upsert + version/expiry semantics WITHOUT the is_active gate, so it is used
-- ONLY on the component path. Components inherit only auto_grant_duration_days (no override).
CREATE OR REPLACE FUNCTION public.grant_bundle_component_access(
  user_id_param UUID,
  product_id_param UUID,
  max_retries INTEGER DEFAULT 3
) RETURNS JSONB AS $$
DECLARE
  effective_duration INTEGER;
  existing_record RECORD;
  new_expires_at TIMESTAMPTZ := NULL;
  final_duration INTEGER := NULL;
  retry_count INTEGER := 0;
  rows_affected INTEGER;
BEGIN
  IF user_id_param IS NULL OR product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID and Product ID are required');
  END IF;

  -- Resolve the component's auto-grant duration WITHOUT requiring is_active (unlike
  -- grant_product_access_service_role). A missing component product is a real failure.
  SELECT auto_grant_duration_days INTO effective_duration
  FROM public.products WHERE id = product_id_param;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Component product not found');
  END IF;

  -- Optimistic-locking upsert (mirrors grant_product_access_service_role; never downgrades a
  -- permanent grant, extends active limited grants, re-grants from now on expired ones).
  WHILE retry_count < max_retries LOOP
    SELECT
      access_expires_at,
      version,
      (access_expires_at IS NULL) AS has_permanent_access,
      (access_expires_at IS NOT NULL AND access_expires_at > NOW()) AS has_active_access
    INTO existing_record
    FROM public.user_product_access
    WHERE user_id = user_id_param AND product_id = product_id_param;

    IF FOUND THEN
      IF existing_record.has_permanent_access THEN
        new_expires_at := NULL;
        final_duration := NULL;
      ELSIF existing_record.has_active_access THEN
        IF effective_duration IS NOT NULL THEN
          new_expires_at := existing_record.access_expires_at + (effective_duration || ' days')::INTERVAL;
          final_duration := effective_duration;
        ELSE
          new_expires_at := NULL;
          final_duration := NULL;
        END IF;
      ELSE
        IF effective_duration IS NOT NULL THEN
          new_expires_at := NOW() + (effective_duration || ' days')::INTERVAL;
          final_duration := effective_duration;
        ELSE
          new_expires_at := NULL;
          final_duration := NULL;
        END IF;
      END IF;

      UPDATE public.user_product_access
      SET
        access_granted_at = NOW(),
        access_duration_days = final_duration,
        access_expires_at = CASE WHEN access_expires_at IS NULL THEN NULL ELSE new_expires_at END,
        version = version + 1
      WHERE user_id = user_id_param AND product_id = product_id_param
        AND version = existing_record.version;

      GET DIAGNOSTICS rows_affected = ROW_COUNT;
      IF rows_affected = 1 THEN
        RETURN jsonb_build_object('success', true, 'operation', 'updated_existing');
      END IF;
      retry_count := retry_count + 1;
      IF retry_count < max_retries THEN PERFORM pg_sleep(0.01 * (2 ^ retry_count)); END IF;
      CONTINUE;
    ELSE
      IF effective_duration IS NOT NULL THEN
        new_expires_at := NOW() + (effective_duration || ' days')::INTERVAL;
        final_duration := effective_duration;
      ELSE
        new_expires_at := NULL;
        final_duration := NULL;
      END IF;

      BEGIN
        INSERT INTO public.user_product_access (
          user_id, product_id, access_duration_days, access_expires_at, access_granted_at, version
        ) VALUES (
          user_id_param, product_id_param, final_duration, new_expires_at, NOW(), 1
        );
        RETURN jsonb_build_object('success', true, 'operation', 'created_new');
      EXCEPTION WHEN unique_violation THEN
        retry_count := retry_count + 1;
        IF retry_count < max_retries THEN PERFORM pg_sleep(0.01 * (2 ^ retry_count)); END IF;
        CONTINUE;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', false, 'error', 'Concurrency conflict after retries');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

REVOKE EXECUTE ON FUNCTION public.grant_bundle_component_access(UUID, UUID, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_bundle_component_access(UUID, UUID, INTEGER) TO service_role;

-- 6) Shared grant primitive: grant the product + (if bundle) each component ------------------------
CREATE OR REPLACE FUNCTION public.grant_product_and_bundle_components(
  user_id_param UUID,
  product_id_param UUID,
  override_duration_days_param INTEGER DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  is_bundle_var BOOLEAN;
  comp_rec RECORD;
  comp_result JSONB;
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
        -- Grants the component regardless of is_active (an inactive component is a SUCCESS).
        comp_result := public.grant_bundle_component_access(user_id_param, comp_rec.component_product_id);
        IF COALESCE((comp_result->>'success')::BOOLEAN, false) THEN
          granted := granted + 1;
        ELSE
          -- Helper returned a real failure (e.g. concurrency conflict, missing product) without
          -- raising. Surface it; the safe-log is wrapped so logging can never escape this loop.
          BEGIN
            PERFORM public.log_admin_action(
              'bundle_component_grant_failure', 'bundle_items', product_id_param::TEXT,
              jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
                'component_product_id', comp_rec.component_product_id,
                'error', comp_result->>'error',
                'function_name', 'grant_product_and_bundle_components')
            );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Unexpected raise from the component grant. Isolate it (one bad component must not block
        -- the rest of the bundle) and log safely.
        BEGIN
          PERFORM public.log_admin_action(
            'bundle_component_grant_failure', 'bundle_items', product_id_param::TEXT,
            jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
              'component_product_id', comp_rec.component_product_id,
              'error_code', SQLSTATE, 'error_message', SQLERRM,
              'function_name', 'grant_product_and_bundle_components')
          );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'granted', granted);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.grant_product_and_bundle_components(UUID, UUID, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_product_and_bundle_components(UUID, UUID, INTEGER) TO service_role;
