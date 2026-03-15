-- =====================================================
-- Cross-schema reads for marketplace
-- =====================================================
-- Provides two SECURITY DEFINER functions that query across all active
-- seller schemas using dynamic UNION ALL. This avoids N+1 API calls
-- and works efficiently with indexed user_id lookups.
--
-- 1. get_user_products_all_sellers() — "My Products" page
-- 2. migrate_guest_purchases_all_schemas() — guest → user on registration
--
-- @see priv/MARKETPLACE-PLAN.md — cross-schema access section

-- ===== FUNCTION 1: Get user's products across ALL seller schemas =====

CREATE OR REPLACE FUNCTION public.get_user_products_all_sellers()
RETURNS TABLE (
  seller_slug TEXT,
  seller_display_name TEXT,
  product_id UUID,
  product_name TEXT,
  product_slug TEXT,
  product_icon TEXT,
  product_price NUMERIC,
  product_currency TEXT,
  access_granted_at TIMESTAMPTZ,
  access_expires_at TIMESTAMPTZ,
  transaction_id UUID,
  transaction_amount NUMERIC,
  transaction_currency TEXT,
  transaction_status TEXT,
  transaction_date TIMESTAMPTZ,
  refund_request_status TEXT,
  refunded_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seller RECORD;
  v_query TEXT := '';
  v_user_id UUID;
BEGIN
  -- Rate limit: 100 req/hour per user
  IF NOT public.check_rate_limit('get_user_products_all_sellers', 100, 60) THEN
    RAISE EXCEPTION 'Rate limit exceeded for get_user_products_all_sellers';
  END IF;

  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_seller IN
    SELECT s.slug, s.display_name, s.schema_name
    FROM public.sellers s
    WHERE s.status = 'active'
    LIMIT 100  -- Cap to prevent DoS with many sellers
  LOOP
    IF v_query != '' THEN
      v_query := v_query || ' UNION ALL ';
    END IF;

    v_query := v_query || format(
      'SELECT
        %L::text AS seller_slug,
        %L::text AS seller_display_name,
        p.id AS product_id,
        p.name AS product_name,
        p.slug AS product_slug,
        p.icon AS product_icon,
        p.price AS product_price,
        p.currency AS product_currency,
        upa.access_granted_at,
        upa.access_expires_at,
        pt.id AS transaction_id,
        pt.amount AS transaction_amount,
        pt.currency AS transaction_currency,
        pt.status AS transaction_status,
        pt.created_at AS transaction_date,
        rr.status AS refund_request_status,
        pt.refunded_amount
      FROM %I.user_product_access upa
      JOIN %I.products p ON p.id = upa.product_id
      LEFT JOIN %I.payment_transactions pt
        ON pt.product_id = p.id
        AND pt.user_id = upa.user_id
        AND pt.status != ''pending''
        AND pt.status != ''abandoned''
      LEFT JOIN %I.refund_requests rr
        ON rr.transaction_id = pt.id
        AND rr.status != ''rejected''
      WHERE upa.user_id = %L::uuid',
      v_seller.slug,
      v_seller.display_name,
      v_seller.schema_name, v_seller.schema_name,
      v_seller.schema_name, v_seller.schema_name,
      v_user_id
    );
  END LOOP;

  IF v_query = '' THEN
    RETURN; -- No active sellers
  END IF;

  v_query := v_query || ' ORDER BY access_granted_at DESC LIMIT 500';

  RETURN QUERY EXECUTE v_query;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_products_all_sellers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_products_all_sellers() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_products_all_sellers() IS
  'Returns all products the current user has access to across all active seller schemas.';


-- ===== FUNCTION 2: Migrate guest purchases across ALL seller schemas =====

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


-- ===== FUNCTION 3: Check if user is a seller owner =====
-- Used by auth system to determine if a user has seller admin access.

CREATE OR REPLACE FUNCTION public.get_seller_for_user(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  seller_id UUID,
  seller_slug TEXT,
  schema_name TEXT,
  display_name TEXT,
  status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.slug, s.schema_name, s.display_name, s.status
  FROM public.sellers s
  WHERE s.user_id = COALESCE(p_user_id, (SELECT auth.uid()))
    AND s.status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.get_seller_for_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_for_user(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_seller_for_user(UUID) IS
  'Returns the seller record owned by the given user. Used to determine seller admin access.';


-- ===== Trigger: migrate guest purchases on registration =====

CREATE OR REPLACE FUNCTION public.migrate_marketplace_guest_purchases()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sellers
    WHERE status = 'active' AND schema_name != 'seller_main'
  ) THEN
    PERFORM public.migrate_guest_purchases_all_schemas(NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_marketplace ON auth.users;

CREATE TRIGGER on_auth_user_created_marketplace
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.migrate_marketplace_guest_purchases();

REVOKE EXECUTE ON FUNCTION public.migrate_marketplace_guest_purchases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_marketplace_guest_purchases() TO service_role;
