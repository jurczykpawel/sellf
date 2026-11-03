-- Daily dashboard chart groups days in the caller's timezone (W78): a purchase just after
-- local midnight belongs to the local day, as in the hourly chart and the payments list.
-- Unknown timezone names fall back to UTC (same rule as get_hourly_revenue_stats).

-- New signature (adds p_timezone): drop the old one so only one overload is exposed.
DROP FUNCTION IF EXISTS public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.get_sales_chart_data(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC'
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
  SELECT
    per_currency.day,
    COALESCE(jsonb_object_agg(per_currency.currency, per_currency.total), '{}'::jsonb),
    SUM(per_currency.orders)::INTEGER
  FROM (
    SELECT
      TO_CHAR(pt.created_at AT TIME ZONE v_timezone, 'YYYY-MM-DD') AS day,
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

REVOKE EXECUTE ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT)
  IS E'@graphql({"include": false})';
