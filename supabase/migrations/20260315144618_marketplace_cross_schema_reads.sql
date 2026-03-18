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


-- ===== FUNCTION: get_expired_access_all_schemas =====
-- Returns expired, un-notified access records from ALL active seller schemas.
-- Used by cron job `access-expired` to dispatch webhooks across the marketplace.
-- Single query with dynamic UNION ALL — no per-schema iteration in application code.

CREATE OR REPLACE FUNCTION public.get_expired_access_all_schemas(
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  seller_slug TEXT,
  seller_schema TEXT,
  access_id UUID,
  user_id UUID,
  product_id UUID,
  product_name TEXT,
  product_slug TEXT,
  product_price NUMERIC,
  product_currency TEXT,
  product_icon TEXT,
  access_granted_at TIMESTAMPTZ,
  access_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seller RECORD;
  v_query TEXT := '';
  v_now TEXT;
BEGIN
  IF (SELECT auth.role()) != 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can call get_expired_access_all_schemas';
  END IF;

  v_now := now()::text;

  FOR v_seller IN
    SELECT s.slug, s.schema_name
    FROM public.sellers s
    WHERE s.status = 'active'
  LOOP
    IF v_query != '' THEN
      v_query := v_query || ' UNION ALL ';
    END IF;

    v_query := v_query || format(
      'SELECT
        %L::text AS seller_slug,
        %L::text AS seller_schema,
        upa.id AS access_id,
        upa.user_id,
        upa.product_id,
        p.name AS product_name,
        p.slug AS product_slug,
        p.price AS product_price,
        p.currency AS product_currency,
        p.icon AS product_icon,
        upa.access_granted_at,
        upa.access_expires_at
      FROM %I.user_product_access upa
      JOIN %I.products p ON p.id = upa.product_id
      WHERE upa.access_expires_at < %L::timestamptz
        AND upa.expiry_notified_at IS NULL',
      v_seller.slug,
      v_seller.schema_name,
      v_seller.schema_name, v_seller.schema_name,
      v_now
    );
  END LOOP;

  IF v_query = '' THEN
    RETURN;
  END IF;

  v_query := v_query || format(' ORDER BY access_expires_at ASC LIMIT %s', p_limit);

  RETURN QUERY EXECUTE v_query;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_expired_access_all_schemas(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_expired_access_all_schemas(INTEGER) TO service_role;


-- ===== FUNCTION: mark_access_expiry_notified =====
-- Marks a specific access record as notified in the correct seller schema.
-- Used by cron after successfully triggering the webhook.

CREATE OR REPLACE FUNCTION public.mark_access_expiry_notified(
  p_schema TEXT,
  p_access_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) != 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can call mark_access_expiry_notified';
  END IF;

  EXECUTE format(
    'UPDATE %I.user_product_access SET expiry_notified_at = now() WHERE id = %L',
    p_schema, p_access_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_access_expiry_notified(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_access_expiry_notified(TEXT, UUID) TO service_role;


-- ===== FUNCTION: cleanup_webhook_logs_all_schemas =====
-- Deletes old webhook_logs from ALL active seller schemas. Returns total deleted count.

CREATE OR REPLACE FUNCTION public.cleanup_webhook_logs_all_schemas(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seller RECORD;
  v_deleted INTEGER := 0;
  v_count INTEGER;
  v_cutoff TIMESTAMPTZ;
BEGIN
  IF (SELECT auth.role()) != 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can call cleanup_webhook_logs_all_schemas';
  END IF;

  v_cutoff := now() - (p_retention_days || ' days')::interval;

  FOR v_seller IN
    SELECT s.schema_name FROM public.sellers s WHERE s.status = 'active'
  LOOP
    EXECUTE format(
      'WITH deleted AS (DELETE FROM %I.webhook_logs WHERE created_at < %L RETURNING 1) SELECT count(*) FROM deleted',
      v_seller.schema_name, v_cutoff
    ) INTO v_count;
    v_deleted := v_deleted + v_count;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_webhook_logs_all_schemas(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_webhook_logs_all_schemas(INTEGER) TO service_role;


-- ===== VIEW: seller_customer_stats =====
-- Like user_access_stats but scoped to CUSTOMERS of this shop only.
-- A "customer" is any user who appears in user_product_access OR payment_transactions.
-- This view is defined in seller_main and cloned to seller schemas.
-- clone_schema replaces seller_main.* references with seller_xyz.* automatically.
--
-- Platform admin uses user_access_stats (LEFT JOIN, all auth.users).
-- Seller admin uses seller_customer_stats (only their customers).

CREATE OR REPLACE VIEW seller_main.seller_customer_stats WITH (security_invoker = on) AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS user_created_at,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.raw_user_meta_data,
  COALESCE(access_stats.total_products, 0) AS total_products,
  COALESCE(access_stats.total_value, 0) AS total_value,
  access_stats.last_access_granted_at,
  access_stats.first_access_granted_at
FROM (
  -- Distinct user IDs from all customer-facing tables in this schema
  SELECT user_id FROM seller_main.user_product_access
  UNION
  SELECT user_id FROM seller_main.payment_transactions WHERE user_id IS NOT NULL
) customers
JOIN auth.users u ON u.id = customers.user_id
LEFT JOIN (
  SELECT
    upa.user_id,
    COUNT(upa.id) AS total_products,
    COALESCE(SUM(p.price), 0) AS total_value,
    MAX(upa.created_at) AS last_access_granted_at,
    MIN(upa.created_at) AS first_access_granted_at
  FROM seller_main.user_product_access upa
  JOIN seller_main.products p ON upa.product_id = p.id
  GROUP BY upa.user_id
) access_stats ON access_stats.user_id = u.id;

-- Same permissions as user_access_stats: service_role only
REVOKE ALL ON seller_main.seller_customer_stats FROM anon, authenticated;
GRANT SELECT ON seller_main.seller_customer_stats TO service_role;

-- Public proxy view for backward compat
CREATE OR REPLACE VIEW public.seller_customer_stats WITH (security_invoker = on)
  AS SELECT * FROM seller_main.seller_customer_stats;
REVOKE ALL ON public.seller_customer_stats FROM anon, authenticated;
GRANT SELECT ON public.seller_customer_stats TO service_role;
