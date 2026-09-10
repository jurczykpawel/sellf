-- Free products requested by e-mail are remembered on the account, so the
-- product reaches the user on any later sign-in (a plain login link, OAuth),
-- not only through the product-access link from the original e-mail.
--
-- The list lives in auth.users.raw_app_meta_data.pending_free_grants (product
-- ids). app_metadata is writable only by the service role, and the auth
-- callback already holds the user object, so a sign-in with nothing pending
-- costs no query at all.

-- ===== Eligibility =====

-- Same free rules as grant_free_product_access (coupon-driven grants are not
-- queued: they need the coupon, which only the original link carries).
CREATE OR REPLACE FUNCTION public.is_free_claimable_product(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.is_active
      AND (p.price = 0 OR (p.allow_custom_price AND p.custom_price_min = 0))
  );
$$;

REVOKE ALL ON FUNCTION public.is_free_claimable_product(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_free_claimable_product(UUID) TO service_role;

-- ===== Queue (server-side, after a free-product magic link was sent) =====

CREATE OR REPLACE FUNCTION public.queue_pending_free_grant(p_email TEXT, p_product_slug TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id UUID;
  v_email TEXT := lower(trim(p_email));
BEGIN
  SELECT p.id INTO v_product_id FROM public.products p WHERE p.slug = p_product_slug;
  IF v_product_id IS NULL OR NOT public.is_free_claimable_product(v_product_id) THEN
    RETURN FALSE;
  END IF;

  UPDATE auth.users u
  SET raw_app_meta_data = jsonb_set(
        COALESCE(u.raw_app_meta_data, '{}'::jsonb),
        '{pending_free_grants}',
        COALESCE(u.raw_app_meta_data -> 'pending_free_grants', '[]'::jsonb) || to_jsonb(v_product_id::TEXT)
      )
  WHERE lower(u.email) = v_email
    AND NOT (COALESCE(u.raw_app_meta_data -> 'pending_free_grants', '[]'::jsonb) ? v_product_id::TEXT)
    AND jsonb_array_length(COALESCE(u.raw_app_meta_data -> 'pending_free_grants', '[]'::jsonb)) < 20
    AND NOT EXISTS (
      SELECT 1 FROM public.user_product_access upa
      WHERE upa.user_id = u.id
        AND upa.product_id = v_product_id
        AND (upa.access_expires_at IS NULL OR upa.access_expires_at > now())
    );

  -- TRUE whenever the account now carries the intent (freshly or already).
  RETURN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(u.email) = v_email
      AND COALESCE(u.raw_app_meta_data -> 'pending_free_grants', '[]'::jsonb) ? v_product_id::TEXT
  );
END;
$$;

REVOKE ALL ON FUNCTION public.queue_pending_free_grant(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_pending_free_grant(TEXT, TEXT) TO service_role;

-- ===== Read on sign-in (caller's own list only) =====

-- Returns the caller's pending products that can still be granted and prunes
-- the rest (no longer free, deleted, or already accessible), so a stale entry
-- is looked at once, not on every sign-in.
CREATE OR REPLACE FUNCTION public.pending_free_grant_products()
RETURNS TABLE (product_id UUID, slug TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_user_id UUID := auth.uid();
  v_keep JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(p.id::TEXT)), '[]'::jsonb)
  INTO v_keep
  FROM auth.users u
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(u.raw_app_meta_data -> 'pending_free_grants', '[]'::jsonb)
  ) AS pending(id)
  JOIN public.products p ON p.id::TEXT = pending.id
  WHERE u.id = v_user_id
    AND public.is_free_claimable_product(p.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_product_access upa
      WHERE upa.user_id = v_user_id
        AND upa.product_id = p.id
        AND (upa.access_expires_at IS NULL OR upa.access_expires_at > now())
    );

  UPDATE auth.users u
  SET raw_app_meta_data = jsonb_set(u.raw_app_meta_data, '{pending_free_grants}', v_keep)
  WHERE u.id = v_user_id
    AND u.raw_app_meta_data ? 'pending_free_grants'
    AND u.raw_app_meta_data -> 'pending_free_grants' IS DISTINCT FROM v_keep;

  RETURN QUERY
  SELECT p.id, p.slug
  FROM public.products p
  WHERE p.id::TEXT IN (SELECT jsonb_array_elements_text(v_keep));
END;
$$;

REVOKE ALL ON FUNCTION public.pending_free_grant_products() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_free_grant_products() TO authenticated, service_role;

-- ===== Clear on grant (any path: free, paid, admin) =====

CREATE OR REPLACE FUNCTION public.clear_pending_free_grant_on_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE auth.users u
  SET raw_app_meta_data = jsonb_set(
        u.raw_app_meta_data,
        '{pending_free_grants}',
        (u.raw_app_meta_data -> 'pending_free_grants') - NEW.product_id::TEXT
      )
  WHERE u.id = NEW.user_id
    AND COALESCE(u.raw_app_meta_data -> 'pending_free_grants', '[]'::jsonb) ? NEW.product_id::TEXT;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_pending_free_grant_on_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_pending_free_grant_on_access ON public.user_product_access;
CREATE TRIGGER clear_pending_free_grant_on_access
  AFTER INSERT OR UPDATE OF product_id, access_expires_at ON public.user_product_access
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_pending_free_grant_on_access();
