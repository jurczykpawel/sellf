/**
 * Shared constants for Order Bumps API v1 endpoints.
 */

export const ORDER_BUMP_SELECT = `
  id,
  main_product_id,
  bump_product_id,
  bump_price,
  bump_title,
  bump_description,
  is_active,
  display_order,
  access_duration_days,
  urgency_duration_minutes,
  created_at,
  updated_at,
  main_product:products!order_bumps_main_product_id_fkey(id, name, slug),
  bump_product:products!order_bumps_bump_product_id_fkey(id, name, slug, price, currency)
`;
