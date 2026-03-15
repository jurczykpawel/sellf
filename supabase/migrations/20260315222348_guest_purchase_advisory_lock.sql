-- Migration: Add advisory lock to migrate_guest_purchases_all_schemas
-- Prevents double-grant when concurrent user registrations with the same email
-- race each other through the guest purchase migration.

CREATE OR REPLACE FUNCTION public.migrate_guest_purchases_all_schemas(
  p_user_id UUID,
  p_email TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seller RECORD;
  v_guest RECORD;
  v_total_migrated INTEGER := 0;
  v_query TEXT;
BEGIN
  IF (SELECT auth.role()) != 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can call migrate_guest_purchases_all_schemas';
  END IF;

  IF p_user_id IS NULL OR p_email IS NULL THEN
    RETURN 0;
  END IF;

  -- Advisory lock keyed on email hash — prevents concurrent migrations for the same email
  PERFORM pg_advisory_xact_lock(hashtext(p_email));

  FOR v_seller IN
    SELECT s.schema_name
    FROM public.sellers s
    WHERE s.status = 'active'
  LOOP
    v_query := format(
      'SELECT product_id FROM %I.guest_purchases WHERE customer_email = %L AND claimed_by_user_id IS NULL',
      v_seller.schema_name, p_email
    );

    FOR v_guest IN EXECUTE v_query
    LOOP
      BEGIN
        EXECUTE format(
          'SELECT %I.grant_product_access_service_role(%L::uuid, %L::uuid)',
          v_seller.schema_name, p_user_id, v_guest.product_id
        );
        v_total_migrated := v_total_migrated + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to grant access in schema % for product %: %',
          v_seller.schema_name, v_guest.product_id, SQLERRM;
      END;
    END LOOP;

    EXECUTE format(
      'UPDATE %I.guest_purchases SET claimed_by_user_id = %L WHERE customer_email = %L AND claimed_by_user_id IS NULL',
      v_seller.schema_name, p_user_id, p_email
    );
  END LOOP;

  RETURN v_total_migrated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.migrate_guest_purchases_all_schemas(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_guest_purchases_all_schemas(UUID, TEXT) TO service_role;
