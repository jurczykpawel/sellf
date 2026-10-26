-- Dashboard charts: daily chart sums every completed payment per currency and day;
-- hourly chart buckets hours (and the target day) in the caller's timezone.

CREATE OR REPLACE FUNCTION public.get_sales_chart_data(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL
)
RETURNS TABLE (
  date TEXT,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    per_currency.day,
    COALESCE(jsonb_object_agg(per_currency.currency, per_currency.total), '{}'::jsonb),
    SUM(per_currency.orders)::INTEGER
  FROM (
    SELECT
      TO_CHAR(pt.created_at, 'YYYY-MM-DD') AS day,
      pt.currency,
      SUM(pt.amount) AS total,
      COUNT(*) AS orders
    FROM public.payment_transactions pt
    WHERE pt.status = 'completed'
      AND pt.created_at >= p_start_date
      AND pt.created_at <= p_end_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ) per_currency
  GROUP BY per_currency.day
  ORDER BY per_currency.day ASC;
END;
$$;

-- New signature (adds p_timezone): drop the old one so only one overload is exposed.
DROP FUNCTION IF EXISTS public.get_hourly_revenue_stats(DATE, UUID);

CREATE OR REPLACE FUNCTION public.get_hourly_revenue_stats(
  p_target_date DATE DEFAULT CURRENT_DATE,
  p_product_id UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  hour INTEGER,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_timezone),
    'UTC'
  ) INTO v_timezone;

  RETURN QUERY
  WITH hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  sales AS (
    SELECT
      EXTRACT(HOUR FROM pt.created_at AT TIME ZONE v_timezone)::INTEGER AS sale_hour,
      pt.currency,
      SUM(pt.amount) AS total_amount,
      COUNT(*) AS total_orders
    FROM public.payment_transactions pt
    WHERE pt.status = 'completed'
      AND (pt.created_at AT TIME ZONE v_timezone)::DATE = p_target_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ),
  aggregated_sales AS (
    SELECT
      sale_hour,
      jsonb_object_agg(currency, total_amount) AS amount_by_currency,
      SUM(total_orders)::INTEGER AS total_orders
    FROM sales
    GROUP BY sale_hour
  )
  SELECT
    hours.h,
    COALESCE(aggregated_sales.amount_by_currency, '{}'::jsonb),
    COALESCE(aggregated_sales.total_orders, 0)::INTEGER
  FROM hours
  LEFT JOIN aggregated_sales ON hours.h = aggregated_sales.sale_hour
  ORDER BY hours.h ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT)
  IS E'@graphql({"include": false})';
