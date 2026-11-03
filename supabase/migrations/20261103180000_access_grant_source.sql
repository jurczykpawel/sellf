-- Where each access grant came from (admin Orders list, demo feedback 2026-10-29 #12).
-- Recorded once at insert; never guessed from the product price.
--
-- Sources: purchase (card or completed order, incl. claimed guest purchases), bundle (component
-- of a purchased bundle), bank_transfer (access on transfer order placement), subscription,
-- free (self-service free claim, incl. 100% coupons), manual (administrator / API grant),
-- unknown (rows created before this column, or a path that does not declare its source).
--
-- How it is set: each granting function declares its source with a function-level setting
-- `sellf.grant_source` (restored on exit, so a nested call such as the bundle component grant
-- wins only for its own rows); the BEFORE INSERT trigger copies it. Row facts that are
-- unambiguous (transfer order / subscription link) take precedence. An explicit value wins.

ALTER TABLE public.user_product_access ADD COLUMN grant_source text;

-- ===== Backfill (described per rule; first matching rule wins) =====
-- 1. Row links: transfer order → bank_transfer, subscription → subscription.
UPDATE public.user_product_access SET grant_source = 'bank_transfer' WHERE transfer_transaction_id IS NOT NULL;
UPDATE public.user_product_access SET grant_source = 'subscription' WHERE grant_source IS NULL AND subscription_id IS NOT NULL;
-- 2. Administrator grants recorded by the admin route audit trail or the access mutation event.
UPDATE public.user_product_access a SET grant_source = 'manual' WHERE a.grant_source IS NULL AND (
  EXISTS (SELECT 1 FROM public.audit_log l WHERE l.table_name = 'user_product_access' AND l.user_id = a.user_id
    AND l.new_values->>'action' = 'admin_grant_access' AND l.new_values->>'product_id' = a.product_id::text)
  OR EXISTS (SELECT 1 FROM public.business_events e WHERE e.event_type = 'access.granted'
    AND e.payload->'access'->>'id' = a.id::text AND e.payload->>'reason' = 'admin_grant'));
-- 3. A payment by this user (directly or via a claimed guest purchase) for the product → purchase;
--    for a bundle containing the product → bundle.
UPDATE public.user_product_access a SET grant_source = 'purchase' WHERE a.grant_source IS NULL AND EXISTS (
  SELECT 1 FROM public.payment_transactions t
  LEFT JOIN public.payment_line_items li ON li.transaction_id = t.id
  WHERE (t.product_id = a.product_id OR li.product_id = a.product_id)
    AND t.status IN ('completed', 'refunded', 'partially_refunded', 'disputed')
    AND (t.user_id = a.user_id OR EXISTS (SELECT 1 FROM public.guest_purchases g
      WHERE g.claimed_by_user_id = a.user_id AND (g.transaction_id = t.id OR g.session_id = t.session_id))));
UPDATE public.user_product_access a SET grant_source = 'bundle' WHERE a.grant_source IS NULL AND EXISTS (
  SELECT 1 FROM public.bundle_items b JOIN public.user_product_access parent
    ON parent.user_id = a.user_id AND parent.product_id = b.bundle_product_id AND parent.grant_source = 'purchase'
  WHERE b.component_product_id = a.product_id);
-- 4. Free claims recorded with their checkout answers.
UPDATE public.user_product_access a SET grant_source = 'free' WHERE a.grant_source IS NULL AND EXISTS (
  SELECT 1 FROM public.free_grant_contexts c JOIN auth.users u ON lower(u.email) = lower(c.email)
  WHERE u.id = a.user_id AND c.product_id = a.product_id AND c.claimed_at IS NOT NULL);
-- 5. Anything else predates source tracking and stays honestly unknown.
UPDATE public.user_product_access SET grant_source = 'unknown' WHERE grant_source IS NULL;

ALTER TABLE public.user_product_access
  ALTER COLUMN grant_source SET NOT NULL,
  ADD CONSTRAINT user_product_access_grant_source_chk
    CHECK (grant_source IN ('purchase', 'bundle', 'bank_transfer', 'subscription', 'free', 'manual', 'unknown'));
CREATE INDEX user_product_access_grant_source_idx ON public.user_product_access (grant_source, access_granted_at DESC);

-- ===== Trigger: fill the source on insert =====
CREATE OR REPLACE FUNCTION public.set_access_grant_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.grant_source := coalesce(
    NEW.grant_source,
    CASE WHEN NEW.transfer_transaction_id IS NOT NULL THEN 'bank_transfer'
         WHEN NEW.subscription_id IS NOT NULL THEN 'subscription' END,
    nullif(current_setting('sellf.grant_source', true), ''),
    'unknown');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_access_grant_source() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER set_access_grant_source
  BEFORE INSERT ON public.user_product_access
  FOR EACH ROW EXECUTE FUNCTION public.set_access_grant_source();

-- ===== Declare the source on every granting path =====
-- A function-level SET of a custom parameter needs superuser on hosted Postgres, so each granting
-- function is renamed to *_impl (grants kept) and a same-signature wrapper sets the source for the
-- duration of the call and restores the caller's value afterwards. Callers (SQL and RPC) are unchanged;
-- a nested call (bundle component inside a bundle purchase) declares its own source only while it runs.

ALTER FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) RENAME TO grant_product_access_service_role_impl;
CREATE FUNCTION public.grant_product_access_service_role(user_id_param uuid, product_id_param uuid, max_retries integer DEFAULT 3, override_duration_days_param integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); result jsonb;
BEGIN
  PERFORM set_config('sellf.grant_source', 'purchase', true);
  result := public.grant_product_access_service_role_impl(user_id_param, product_id_param, max_retries, override_duration_days_param);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;

ALTER FUNCTION public.grant_bundle_component_access(uuid, uuid, integer) RENAME TO grant_bundle_component_access_impl;
CREATE FUNCTION public.grant_bundle_component_access(user_id_param uuid, product_id_param uuid, max_retries integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); result jsonb;
BEGIN
  PERFORM set_config('sellf.grant_source', 'bundle', true);
  result := public.grant_bundle_component_access_impl(user_id_param, product_id_param, max_retries);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;

ALTER FUNCTION public.grant_free_product_access(text, integer, text) RENAME TO grant_free_product_access_impl;
CREATE FUNCTION public.grant_free_product_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL, coupon_code_param text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); result boolean;
BEGIN
  PERFORM set_config('sellf.grant_source', 'free', true);
  result := public.grant_free_product_access_impl(product_slug_param, access_duration_days_param, coupon_code_param);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;

ALTER FUNCTION public.mutate_access(text, uuid, uuid, uuid, jsonb, jsonb) RENAME TO mutate_access_impl;
CREATE FUNCTION public.mutate_access(p_action text, p_user_id uuid, p_product_id uuid DEFAULT NULL, p_access_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}', p_actor jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true);
BEGIN
  PERFORM set_config('sellf.grant_source', 'manual', true);
  RETURN QUERY SELECT * FROM public.mutate_access_impl(p_action, p_user_id, p_product_id, p_access_id, p_values, p_actor);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
END;
$$;

-- Wrappers are SECURITY INVOKER: the caller needs the same EXECUTE rights it had on the original.
REVOKE ALL ON FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.grant_bundle_component_access(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_bundle_component_access(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.grant_free_product_access(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_free_product_access(text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mutate_access(text, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access(text, uuid, uuid, uuid, jsonb, jsonb) TO service_role;
-- The renamed implementations keep their original grants; restate them explicitly on the new names.
REVOKE EXECUTE ON FUNCTION public.grant_product_access_service_role_impl(uuid, uuid, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_bundle_component_access_impl(uuid, uuid, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mutate_access_impl(text, uuid, uuid, uuid, jsonb, jsonb) FROM anon, authenticated, PUBLIC;
-- Free claims run as the signed-in buyer through the invoker wrapper, so authenticated keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.grant_free_product_access_impl(text, integer, text) FROM anon, PUBLIC;

-- ===== Webhook payload: access.granted / access.updated carry grantSource =====
-- Additive field next to the legacy `reason` (kept unchanged for existing integrations);
-- grantSource is the recorded source, `reason` may still be inferred for older rules.
CREATE OR REPLACE FUNCTION public.add_access_grant_source_to_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE source text;
BEGIN
  IF NEW.event_type IN ('access.granted', 'access.updated') AND NEW.payload->'access' ? 'id' THEN
    SELECT a.grant_source INTO source FROM public.user_product_access a WHERE a.id::text = NEW.payload->'access'->>'id';
    IF source IS NOT NULL THEN NEW.payload := NEW.payload || jsonb_build_object('grantSource', source); END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_access_grant_source_to_event() FROM anon, authenticated, PUBLIC;

CREATE TRIGGER add_access_grant_source
  BEFORE INSERT ON public.business_events
  FOR EACH ROW EXECUTE FUNCTION public.add_access_grant_source_to_event();
