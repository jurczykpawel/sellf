-- =============================================================================
-- Migration: Add service_role bypass to is_admin()
--
-- is_admin() is used by 91+ RLS policies and SQL functions for data access.
-- service_role bypass allows server-side admin operations (via createAdminClient)
-- to pass RLS checks after TypeScript auth verification.
-- =============================================================================

-- =====================================================
-- is_admin() — service_role bypass, admin_users only
-- =====================================================

CREATE OR REPLACE FUNCTION is_admin(user_id_param UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    current_user_id UUID;
    target_user_id UUID;
BEGIN
    -- Service role is always trusted (used by admin clients after TS auth checks)
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

    RETURN EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = target_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';
