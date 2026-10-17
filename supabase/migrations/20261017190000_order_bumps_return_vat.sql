-- The checkout page needs each bump product's own VAT settings to show a total that
-- matches the charge (net bumps get VAT added on top, exempt bumps do not).
-- Return type changes, so the function is dropped and recreated with the same
-- security attributes and grants as 20260310175058_multi_order_bumps.sql.
DROP FUNCTION IF EXISTS public.get_product_order_bumps(UUID);

CREATE OR REPLACE FUNCTION public.get_product_order_bumps(
  product_id_param UUID
) RETURNS TABLE (
  bump_id UUID,
  bump_product_id UUID,
  bump_product_name TEXT,
  bump_product_description TEXT,
  bump_product_icon TEXT,
  bump_price NUMERIC,
  original_price NUMERIC,
  bump_access_duration INTEGER,
  bump_currency TEXT,
  bump_title TEXT,
  bump_description TEXT,
  display_order INTEGER,
  urgency_duration_minutes INTEGER,
  vat_rate NUMERIC,
  price_includes_vat BOOLEAN,
  vat_exempt BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ob.id as bump_id,
    ob.bump_product_id,
    p.name as bump_product_name,
    p.description as bump_product_description,
    p.icon as bump_product_icon,
    COALESCE(ob.bump_price, p.price) as bump_price,
    p.price as original_price,
    COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as bump_access_duration,
    p.currency as bump_currency,
    ob.bump_title,
    ob.bump_description,
    ob.display_order,
    ob.urgency_duration_minutes,
    p.vat_rate,
    p.price_includes_vat,
    p.vat_exempt
  FROM public.order_bumps ob
  INNER JOIN public.products p ON p.id = ob.bump_product_id
  WHERE ob.main_product_id = product_id_param
    AND ob.is_active = true
    AND p.is_active = true
  ORDER BY ob.display_order ASC, ob.created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.get_product_order_bumps FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_order_bumps TO anon, authenticated, service_role;
