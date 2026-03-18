-- Migration: Add refund info to get_user_products_all_sellers RPC
-- The my-purchases page needs is_refundable and refund_period_days to show the refund button.

-- Must DROP first because we're changing the return type (adding columns)
DROP FUNCTION IF EXISTS public.get_user_products_all_sellers();

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
  refunded_amount NUMERIC,
  is_refundable BOOLEAN,
  refund_period_days INTEGER
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
    LIMIT 100
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
        pt.refunded_amount,
        p.is_refundable,
        p.refund_period_days
      FROM %I.user_product_access upa
      JOIN %I.products p ON p.id = upa.product_id
      LEFT JOIN %I.payment_transactions pt
        ON pt.product_id = p.id
        AND pt.user_id = upa.user_id
        AND pt.status != ''pending''
        AND pt.status != ''abandoned''
      LEFT JOIN %I.refund_requests rr
        ON rr.transaction_id = pt.id
      WHERE upa.user_id = %L::uuid',
      v_seller.slug,
      v_seller.display_name,
      v_seller.schema_name, v_seller.schema_name,
      v_seller.schema_name, v_seller.schema_name,
      v_user_id
    );
  END LOOP;

  IF v_query = '' THEN
    RETURN;
  END IF;

  v_query := v_query || ' ORDER BY access_granted_at DESC LIMIT 500';

  RETURN QUERY EXECUTE v_query;
END;
$$;

COMMENT ON FUNCTION public.get_user_products_all_sellers IS
  'Returns all products the current user has access to across all active seller schemas.';

REVOKE EXECUTE ON FUNCTION public.get_user_products_all_sellers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_products_all_sellers() TO authenticated, service_role;
