-- Variant selector page must show promotional (sale) prices, same as the
-- single-product checkout page does. The get_variant_group / _by_slug RPCs
-- powering /v/[group] never projected the Omnibus sale columns, so the public
-- variant list could only ever render the regular price.
--
-- Redefine both functions adding sale_price, sale_price_until,
-- sale_quantity_limit and sale_quantity_sold to the projection. Everything
-- else (joins, filters, ordering, grants, SECURITY DEFINER + search_path) is
-- carried over verbatim from 20260306190000_variant_groups_is_active.sql.

-- get_variant_group(UUID)
DROP FUNCTION IF EXISTS public.get_variant_group(UUID);

CREATE FUNCTION public.get_variant_group(p_group_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  variant_name VARCHAR(100),
  display_order INTEGER,
  is_featured BOOLEAN,
  price NUMERIC,
  currency TEXT,
  description TEXT,
  image_url TEXT,
  icon TEXT,
  is_active BOOLEAN,
  allow_custom_price BOOLEAN,
  custom_price_min NUMERIC,
  sale_price NUMERIC,
  sale_price_until TIMESTAMPTZ,
  sale_quantity_limit INTEGER,
  sale_quantity_sold INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    pvg.variant_name,
    pvg.display_order,
    pvg.is_featured,
    p.price,
    p.currency,
    p.description,
    p.image_url,
    p.icon,
    p.is_active,
    p.allow_custom_price,
    p.custom_price_min,
    p.sale_price,
    p.sale_price_until,
    p.sale_quantity_limit,
    p.sale_quantity_sold
  FROM public.products p
  INNER JOIN public.product_variant_groups pvg ON pvg.product_id = p.id
  INNER JOIN public.variant_groups vg ON vg.id = pvg.group_id
  WHERE pvg.group_id = p_group_id
    AND p.is_active = true
    AND vg.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION public.get_variant_group(UUID) IS 'Get all active variants in an active group by UUID (M:N schema), incl. Omnibus sale pricing';
-- Reset the implicit PUBLIC grant a fresh CREATE FUNCTION carries, then grant
-- explicitly. This is a public storefront RPC, so anon must keep access.
REVOKE EXECUTE ON FUNCTION public.get_variant_group(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_variant_group(UUID) TO anon, authenticated, service_role;

-- get_variant_group_by_slug(TEXT)
DROP FUNCTION IF EXISTS public.get_variant_group_by_slug(TEXT);

CREATE FUNCTION public.get_variant_group_by_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  variant_name VARCHAR(100),
  display_order INTEGER,
  is_featured BOOLEAN,
  price NUMERIC,
  currency TEXT,
  description TEXT,
  image_url TEXT,
  icon TEXT,
  is_active BOOLEAN,
  allow_custom_price BOOLEAN,
  custom_price_min NUMERIC,
  sale_price NUMERIC,
  sale_price_until TIMESTAMPTZ,
  sale_quantity_limit INTEGER,
  sale_quantity_sold INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    pvg.variant_name,
    pvg.display_order,
    pvg.is_featured,
    p.price,
    p.currency,
    p.description,
    p.image_url,
    p.icon,
    p.is_active,
    p.allow_custom_price,
    p.custom_price_min,
    p.sale_price,
    p.sale_price_until,
    p.sale_quantity_limit,
    p.sale_quantity_sold
  FROM public.products p
  INNER JOIN public.product_variant_groups pvg ON pvg.product_id = p.id
  INNER JOIN public.variant_groups vg ON vg.id = pvg.group_id
  WHERE vg.slug = p_slug
    AND p.is_active = true
    AND vg.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION public.get_variant_group_by_slug(TEXT) IS 'Get all active variants in an active group by slug (M:N schema), incl. Omnibus sale pricing';
-- Reset the implicit PUBLIC grant a fresh CREATE FUNCTION carries, then grant
-- explicitly. This is a public storefront RPC, so anon must keep access.
REVOKE EXECUTE ON FUNCTION public.get_variant_group_by_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_variant_group_by_slug(TEXT) TO anon, authenticated, service_role;
