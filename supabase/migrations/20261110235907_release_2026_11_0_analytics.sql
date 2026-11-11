-- Sellf 2026.11.0: analytics.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261026090000_dashboard_chart_sums.sql =====
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

-- ===== Source: 20261103190000_checkout_funnel_other_bucket.sql =====
-- Checkout funnel: count attempts in other statuses (awaiting_payment bank transfers, cancelled)
-- as 'other' so recorded attempts = paid + pending + abandoned + other.
-- Related: supabase/tests/checkout-funnel.sql
CREATE OR REPLACE FUNCTION public.get_checkout_funnel(
  p_days integer DEFAULT 30,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND NOT COALESCE((SELECT public.is_admin()), false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Invalid funnel period' USING ERRCODE = '22023';
  END IF;

  WITH buckets AS (
    SELECT pt.product_id,
      CASE
        WHEN pt.status IN ('completed', 'refunded', 'partially_refunded', 'disputed') THEN 'paid'
        WHEN pt.status IN ('pending', 'abandoned') THEN pt.status
        ELSE 'other'
      END AS bucket,
      count(*) AS attempts
    FROM public.payment_transactions pt
    WHERE pt.created_at >= now() - make_interval(days => p_days)
      AND pt.created_at <= now()
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.product_id, bucket
  ), per_product AS (
    SELECT product_id, sum(attempts) AS started,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'paid'), 0) AS paid,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'pending'), 0) AS pending,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'abandoned'), 0) AS abandoned,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'other'), 0) AS other
    FROM buckets
    GROUP BY product_id
  ), top_products AS (
    SELECT * FROM per_product ORDER BY started DESC, product_id LIMIT 100
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
      'started', COALESCE(sum(started), 0), 'paid', COALESCE(sum(paid), 0),
      'pending', COALESCE(sum(pending), 0), 'abandoned', COALESCE(sum(abandoned), 0),
      'other', COALESCE(sum(other), 0)
    ) FROM per_product),
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productId', t.product_id, 'name', p.name,
      'started', t.started, 'paid', t.paid, 'pending', t.pending, 'abandoned', t.abandoned, 'other', t.other
    ) ORDER BY t.started DESC, t.product_id), '[]'::jsonb)
    FROM top_products t LEFT JOIN public.products p ON p.id = t.product_id)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) TO service_role;

-- ===== Source: 20261103193000_tutorial_progress.sql =====
-- Guided tutorials: which tutorial each user has already been shown (auto-start happens once per user).
-- @see admin-panel/src/lib/tutorials/registry.ts, admin-panel/src/lib/actions/tutorial-progress.ts

CREATE TABLE public.tutorial_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tutorial_id text NOT NULL CHECK (tutorial_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutorial_id)
);

ALTER TABLE public.tutorial_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.tutorial_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own tutorial progress" ON public.tutorial_progress
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users record own tutorial progress" ON public.tutorial_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

REVOKE ALL ON public.tutorial_progress FROM anon, authenticated;
GRANT SELECT, INSERT ON public.tutorial_progress TO authenticated;
GRANT ALL ON public.tutorial_progress TO service_role;

-- ===== Source: 20261103200000_sales_chart_timezone.sql =====
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

-- ===== Source: 20261108165000_retained_payment_revenue.sql =====
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
