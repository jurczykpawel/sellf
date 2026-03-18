-- =============================================================================
-- Migration: Seller admin auth functions + sellers table ownership policies
--
-- Three functions with distinct responsibilities:
--
--   is_admin()        — Data access (91 RLS policies + SQL functions).
--                       Checks admin_users only. service_role bypass (trusted
--                       after TS auth). Does NOT check sellers — adding sellers
--                       here would create a cross-tenant RLS bypass.
--
--   is_admin_cached() — UI/navigation only (AuthContext in browser).
--                       Checks admin_users OR sellers. NOT used in any RLS
--                       policy or SQL function — safe to include sellers.
--
--   is_platform_admin() — Sellers table policies only. Checks admin_users
--                         only (no sellers, no service_role bypass).
--
-- Seller admin flow:
--   browser → is_admin_cached() = true → sees dashboard UI
--   → server action → withAdminOrSellerAuth → service_role client (schema-scoped)
--   → is_admin() = true (service_role bypass) → data from correct schema
--
-- Cross-tenant protection:
--   seller via browser → is_admin() = false → RLS blocks → no access to
--   seller_main or other sellers' schemas
--
-- Also: sellers table ownership policies + column-level UPDATE grant.
-- =============================================================================


-- =====================================================
-- 1. is_admin() — service_role bypass, admin_users only
-- =====================================================

CREATE OR REPLACE FUNCTION is_admin(user_id_param UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    current_user_id UUID;
    target_user_id UUID;
BEGIN
    -- Service role is always trusted (used by admin/seller clients after TS auth checks)
    IF (SELECT auth.role()) = 'service_role' THEN
        RETURN TRUE;
    END IF;

    current_user_id := (SELECT auth.uid());

    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    target_user_id := COALESCE(user_id_param, current_user_id);

    -- Security: Only allow users to check their own admin status
    IF user_id_param IS NOT NULL AND user_id_param != current_user_id THEN
        RETURN FALSE;
    END IF;

    -- Platform admin only (NOT sellers — see migration header for rationale)
    RETURN EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = target_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';


-- =====================================================
-- 2. is_admin_cached() — UI/navigation, checks sellers
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_admin_cached()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_user_id UUID;
    user_is_admin BOOLEAN;
    cache_key TEXT;
BEGIN
    -- Service role bypass
    IF (SELECT auth.role()) = 'service_role' THEN
        RETURN TRUE;
    END IF;

    current_user_id := (SELECT auth.uid());
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    cache_key := 'app.user_is_admin_' || replace(current_user_id::TEXT, '-', '_');

    BEGIN
        user_is_admin := current_setting(cache_key, true)::boolean;
        IF user_is_admin IS NOT NULL THEN
            RETURN user_is_admin;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            NULL;
    END;

    -- Check admin_users (platform admin) OR sellers (seller admin)
    -- Safe for UI/navigation — NOT used in RLS policies
    SELECT EXISTS(
        SELECT 1 FROM public.admin_users WHERE user_id = current_user_id
    ) OR EXISTS(
        SELECT 1 FROM public.sellers WHERE user_id = current_user_id AND status = 'active'
    ) INTO user_is_admin;

    PERFORM set_config(cache_key, user_is_admin::TEXT, false);

    RETURN user_is_admin;
END;
$$;


-- =====================================================
-- 3. is_platform_admin() — sellers table policies only
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_user_id UUID;
BEGIN
    current_user_id := (SELECT auth.uid());
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = current_user_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;


-- =====================================================
-- 4. Sellers table: ownership policies + column grant
-- =====================================================

-- Replace blanket admin policy with platform-admin-only + seller self-update
DROP POLICY IF EXISTS "sellers_admin_all" ON public.sellers;

CREATE POLICY "sellers_platform_admin_all" ON public.sellers
  FOR ALL
  TO authenticated
  USING (( select public.is_platform_admin() ))
  WITH CHECK (( select public.is_platform_admin() ));

CREATE POLICY "sellers_own_update" ON public.sellers
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- Column-level grant: only display_name and stripe_onboarding_complete.
-- Critical columns (platform_fee_percent, stripe_account_id, schema_name, status, user_id)
-- are NOT updatable by authenticated users — only service_role (provisioning).
GRANT UPDATE (display_name, stripe_onboarding_complete) ON public.sellers TO authenticated;
