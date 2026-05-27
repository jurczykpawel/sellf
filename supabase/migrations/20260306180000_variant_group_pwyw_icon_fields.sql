-- Add icon, allow_custom_price, custom_price_min to variant group RPC functions
-- Required for variant selector page to display product icons and PWYW pricing info
-- Must DROP before CREATE because return type changes are not allowed with OR REPLACE

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
  custom_price_min NUMERIC
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
    p.custom_price_min
  FROM public.products p
  INNER JOIN public.product_variant_groups pvg ON pvg.product_id = p.id
  WHERE pvg.group_id = p_group_id
    AND p.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION public.get_variant_group(UUID) IS 'Get all active variants in a group by UUID (M:N schema)';
GRANT EXECUTE ON FUNCTION public.get_variant_group(UUID) TO anon, authenticated, service_role;

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
  custom_price_min NUMERIC
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
    p.custom_price_min
  FROM public.products p
  INNER JOIN public.product_variant_groups pvg ON pvg.product_id = p.id
  INNER JOIN public.variant_groups vg ON vg.id = pvg.group_id
  WHERE vg.slug = p_slug
    AND p.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION public.get_variant_group_by_slug(TEXT) IS 'Get all active variants in a group by slug (M:N schema)';
GRANT EXECUTE ON FUNCTION public.get_variant_group_by_slug(TEXT) TO anon, authenticated, service_role;
