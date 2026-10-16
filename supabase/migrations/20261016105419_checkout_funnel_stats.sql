-- Recorded payment funnel; totals cover the whole period, table covers the top 100 products.
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
    SELECT pt.product_id, pt.currency,
      CASE
        WHEN pt.status IN ('completed', 'refunded', 'partially_refunded', 'disputed') THEN 'paid'
        ELSE pt.status
      END AS bucket,
      count(*) AS attempts
    FROM public.payment_transactions pt
    WHERE pt.created_at >= now() - make_interval(days => p_days)
      AND pt.created_at <= now()
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.product_id, pt.currency, bucket
  ), per_product AS (
    SELECT product_id, sum(attempts) AS started,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'paid'), 0) AS paid,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'pending'), 0) AS pending,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'abandoned'), 0) AS abandoned
    FROM buckets
    GROUP BY product_id
  ), top_products AS (
    SELECT * FROM per_product ORDER BY started DESC, product_id LIMIT 100
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
      'started', COALESCE(sum(started), 0), 'paid', COALESCE(sum(paid), 0),
      'pending', COALESCE(sum(pending), 0), 'abandoned', COALESCE(sum(abandoned), 0)
    ) FROM per_product),
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productId', t.product_id, 'name', p.name,
      'started', t.started, 'paid', t.paid, 'pending', t.pending, 'abandoned', t.abandoned
    ) ORDER BY t.started DESC, t.product_id), '[]'::jsonb)
    FROM top_products t LEFT JOIN public.products p ON p.id = t.product_id)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) TO service_role;
