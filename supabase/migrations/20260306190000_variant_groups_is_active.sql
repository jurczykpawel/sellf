-- Add is_active to variant_groups table
-- Allows deactivating a variant selector page without deleting the group

ALTER TABLE seller_main.variant_groups
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

-- Refresh proxy view to include new column
CREATE OR REPLACE VIEW public.variant_groups WITH (security_invoker = on) AS SELECT * FROM seller_main.variant_groups;

COMMENT ON COLUMN seller_main.variant_groups.is_active IS 'Controls visibility of the variant group on the public selector page';

-- Update RPC functions to filter inactive groups
-- get_variant_group(UUID): needs to join variant_groups to check is_active
DROP FUNCTION IF EXISTS seller_main.get_variant_group(UUID);

CREATE FUNCTION seller_main.get_variant_group(p_group_id UUID)
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
SET search_path = seller_main
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
  FROM seller_main.products p
  INNER JOIN seller_main.product_variant_groups pvg ON pvg.product_id = p.id
  INNER JOIN seller_main.variant_groups vg ON vg.id = pvg.group_id
  WHERE pvg.group_id = p_group_id
    AND p.is_active = true
    AND vg.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION seller_main.get_variant_group(UUID) IS 'Get all active variants in an active group by UUID (M:N schema)';
GRANT EXECUTE ON FUNCTION seller_main.get_variant_group(UUID) TO anon, authenticated, service_role;

-- get_variant_group_by_slug(TEXT): already joins variant_groups, just add the filter
DROP FUNCTION IF EXISTS seller_main.get_variant_group_by_slug(TEXT);

CREATE FUNCTION seller_main.get_variant_group_by_slug(p_slug TEXT)
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
SET search_path = seller_main
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
  FROM seller_main.products p
  INNER JOIN seller_main.product_variant_groups pvg ON pvg.product_id = p.id
  INNER JOIN seller_main.variant_groups vg ON vg.id = pvg.group_id
  WHERE vg.slug = p_slug
    AND p.is_active = true
    AND vg.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION seller_main.get_variant_group_by_slug(TEXT) IS 'Get all active variants in an active group by slug (M:N schema)';
GRANT EXECUTE ON FUNCTION seller_main.get_variant_group_by_slug(TEXT) TO anon, authenticated, service_role;
