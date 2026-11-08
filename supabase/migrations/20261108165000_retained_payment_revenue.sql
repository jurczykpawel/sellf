CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_users INTEGER;
  total_products INTEGER;
  total_revenue NUMERIC;
  active_users_7d INTEGER;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO total_users FROM auth.users;
  SELECT COUNT(*) INTO total_products FROM public.products WHERE is_active = true;
  SELECT COALESCE(SUM(GREATEST(amount - COALESCE(refunded_amount, 0), 0)), 0) INTO total_revenue
  FROM public.payment_transactions WHERE status IN ('completed', 'partially_refunded');

  SELECT COUNT(DISTINCT user_id) INTO active_users_7d
  FROM public.user_product_access
  WHERE created_at > NOW() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'totalProducts', total_products,
    'totalUsers', total_users,
    'totalAccess', (SELECT COUNT(*) FROM public.user_product_access),
    'activeUsers', active_users_7d,
    'totalRevenue', total_revenue
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_detailed_revenue_stats(
  p_product_id UUID DEFAULT NULL,
  p_goal_start_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_revenue_by_currency JSONB;
  v_today_revenue_by_currency JSONB;
  v_today_orders INTEGER;
  v_last_order_at TIMESTAMPTZ;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_object_agg(currency, total), '{}'::jsonb)
  INTO v_total_revenue_by_currency
  FROM (
    SELECT pt.currency, SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) as total
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
      AND (p_goal_start_date IS NULL OR pt.created_at >= p_goal_start_date)
    GROUP BY pt.currency
  ) sub;

  SELECT
    COALESCE(jsonb_object_agg(currency, total), '{}'::jsonb),
    COALESCE(SUM(order_count), 0)::INTEGER
  INTO v_today_revenue_by_currency, v_today_orders
  FROM (
    SELECT pt.currency, SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) as total, COUNT(*) as order_count
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
      AND pt.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.currency
  ) sub;

  SELECT pt.created_at INTO v_last_order_at
  FROM public.payment_transactions pt
  WHERE pt.status IN ('completed', 'partially_refunded')
    AND (p_product_id IS NULL OR pt.product_id = p_product_id)
  ORDER BY pt.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'totalRevenue', v_total_revenue_by_currency,
    'todayRevenue', v_today_revenue_by_currency,
    'todayOrders', v_today_orders,
    'lastOrderAt', v_last_order_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) TO authenticated;


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
      SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) AS total,
      COUNT(*) AS orders
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
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
      SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) AS total_amount,
      COUNT(*) AS total_orders
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
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

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_payment_summary(p_today_start timestamptz, p_month_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_today_start IS NULL OR p_month_start IS NULL THEN RAISE EXCEPTION 'Date boundaries are required'; END IF;
  WITH amounts AS (
    SELECT upper(currency) AS currency, status, created_at, coalesce(refunded_amount, 0) AS refunded,
      CASE WHEN status IN ('completed', 'partially_refunded') THEN greatest(amount - coalesce(refunded_amount, 0), 0) ELSE 0 END AS retained,
      status IN ('completed', 'partially_refunded') AS paid
    FROM public.payment_transactions
  ), currencies AS (
    SELECT currency,
      count(*) FILTER (WHERE paid) AS transactions,
      count(*) FILTER (WHERE paid AND created_at >= p_today_start) AS today_transactions,
      count(*) FILTER (WHERE paid AND created_at >= p_month_start) AS month_transactions,
      coalesce(sum(retained), 0) AS revenue,
      coalesce(sum(retained) FILTER (WHERE created_at >= p_today_start), 0) AS today,
      coalesce(sum(retained) FILTER (WHERE created_at >= p_month_start), 0) AS month,
      coalesce(sum(refunded) FILTER (WHERE refunded > 0), 0) AS refunds,
      count(*) FILTER (WHERE status = 'pending') AS pending
    FROM amounts GROUP BY currency
  )
  SELECT jsonb_build_object(
    'total_transactions', coalesce(sum(transactions), 0),
    'total_revenue', coalesce(sum(revenue), 0),
    'today_revenue', coalesce(sum(today), 0),
    'this_month_revenue', coalesce(sum(month), 0),
    'refunded_amount', coalesce(sum(refunds), 0),
    'pending_count', coalesce(sum(pending), 0),
    'total_revenue_by_currency', coalesce(jsonb_object_agg(currency, revenue) FILTER (WHERE transactions > 0), '{}'::jsonb),
    'today_revenue_by_currency', coalesce(jsonb_object_agg(currency, today) FILTER (WHERE today_transactions > 0), '{}'::jsonb),
    'this_month_revenue_by_currency', coalesce(jsonb_object_agg(currency, month) FILTER (WHERE month_transactions > 0), '{}'::jsonb),
    'refunded_amount_by_currency', coalesce(jsonb_object_agg(currency, refunds) FILTER (WHERE refunds > 0), '{}'::jsonb),
    'by_currency', coalesce(jsonb_object_agg(currency, jsonb_build_object('total_revenue', revenue, 'transaction_count', transactions)) FILTER (WHERE transactions > 0), '{}'::jsonb)
  ) INTO result FROM currencies;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payment_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_summary(timestamptz, timestamptz) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_payment_summary(timestamptz, timestamptz) IS E'@graphql({"include": false})';

CREATE OR REPLACE FUNCTION public.get_revenue_groups(p_start timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL, p_product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(groups)), '[]'::jsonb) INTO result FROM (
    SELECT product_id, upper(currency) AS currency, status,
      date_trunc('day', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS created_at,
      sum(CASE WHEN status = 'refunded' THEN 0 ELSE greatest(amount - coalesce(refunded_amount, 0), 0) END) AS amount,
      sum(coalesce(refunded_amount, 0)) AS refunded_amount, count(*) AS transaction_count
    FROM public.payment_transactions
    WHERE status IN ('completed', 'partially_refunded', 'refunded')
      AND (p_start IS NULL OR created_at >= p_start)
      AND (p_end IS NULL OR created_at <= p_end)
      AND (p_product_id IS NULL OR product_id = p_product_id)
    GROUP BY product_id, upper(currency), status, date_trunc('day', created_at AT TIME ZONE 'UTC')
  ) groups;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_revenue_groups(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_groups(timestamptz, timestamptz, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_revenue_groups(timestamptz, timestamptz, uuid) IS E'@graphql({"include": false})';
