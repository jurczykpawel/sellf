-- Literal searches retain the table result shape for filters, embeds and pagination.
CREATE FUNCTION public.search_payment_transactions(p_search text, p_include_identifiers boolean DEFAULT true)
RETURNS SETOF public.payment_transactions
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT t.* FROM public.payment_transactions t
  WHERE strpos(lower(t.customer_email), lower(p_search)) > 0
    OR (p_include_identifiers AND (strpos(lower(t.session_id), lower(p_search)) > 0
      OR strpos(lower(t.stripe_payment_intent_id), lower(p_search)) > 0))
    OR (trim(p_search) ~ '^#?[0-9]{1,15}$' AND t.order_number::text = ltrim(trim(p_search), '#0'))
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = t.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

CREATE FUNCTION public.search_order_accesses(p_search text)
RETURNS SETOF public.user_product_access
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT a.* FROM public.user_product_access a
  WHERE EXISTS (SELECT 1 FROM public.user_access_stats u WHERE u.user_id = a.user_id AND strpos(lower(u.email), lower(p_search)) > 0)
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = a.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

CREATE FUNCTION public.search_order_leads(p_search text)
RETURNS SETOF public.lead_submissions
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT l.* FROM public.lead_submissions l
  WHERE strpos(lower(l.email), lower(p_search)) > 0
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = l.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

REVOKE ALL ON FUNCTION public.search_payment_transactions(text,boolean), public.search_order_accesses(text), public.search_order_leads(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_payment_transactions(text,boolean), public.search_order_accesses(text), public.search_order_leads(text) TO service_role;
