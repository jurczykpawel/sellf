-- Migration: Add advisory lock to migrate_guest_purchases
-- Prevents double-grant when concurrent user registrations with the same email
-- race each other through the guest purchase migration.

CREATE OR REPLACE FUNCTION public.migrate_guest_purchases(
  p_user_id UUID,
  p_email TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_guest RECORD;
  v_total_migrated INTEGER := 0;
BEGIN
  IF (SELECT auth.role()) != 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can call migrate_guest_purchases';
  END IF;

  IF p_user_id IS NULL OR p_email IS NULL THEN
    RETURN 0;
  END IF;

  -- Advisory lock keyed on email hash — prevents concurrent migrations for the same email
  PERFORM pg_advisory_xact_lock(hashtext(p_email));

  FOR v_guest IN
    SELECT product_id
    FROM seller_main.guest_purchases
    WHERE customer_email = p_email
      AND claimed_by_user_id IS NULL
  LOOP
    BEGIN
      PERFORM seller_main.grant_product_access_service_role(p_user_id, v_guest.product_id);
      UPDATE seller_main.guest_purchases
        SET claimed_by_user_id = p_user_id
        WHERE customer_email = p_email
          AND product_id = v_guest.product_id
          AND claimed_by_user_id IS NULL;
      v_total_migrated := v_total_migrated + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to grant access for product %: %',
        v_guest.product_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_total_migrated;
END;
$$;

-- Drop old multi-schema version if exists
DROP FUNCTION IF EXISTS public.migrate_guest_purchases_all_schemas(UUID, TEXT);

REVOKE EXECUTE ON FUNCTION public.migrate_guest_purchases(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_guest_purchases(UUID, TEXT) TO service_role;


-- Drop duplicate registration trigger.
-- Both `user_registration_trigger` (core_schema) and `on_auth_user_created` (features)
-- fire on auth.users INSERT and call handle_new_user_registration() — unnecessary overhead.
-- Keep `on_auth_user_created`, drop the older one.
DROP TRIGGER IF EXISTS user_registration_trigger ON auth.users;
