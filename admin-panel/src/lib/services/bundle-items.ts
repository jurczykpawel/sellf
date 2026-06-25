/**
 * Bundle component persistence.
 *
 * A bundle product (products.is_bundle = true) links to its component products
 * through the `bundle_items` junction table. The products API replaces the whole
 * ordered set on each write, so this helper deletes the existing links and
 * re-inserts the new ones with display_order = array index.
 *
 * Component validity (no nested bundles, no subscriptions, parent must be a
 * bundle) is enforced by the `bundle_items` validation trigger — an invalid
 * component makes the insert throw, which the caller surfaces as an API error.
 *
 * @see supabase/migrations (bundle_items table + validation trigger)
 * @see ../../app/api/v1/products/route.ts (create wiring)
 * @see ../../app/api/v1/products/[id]/route.ts (update wiring)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Replace a bundle's component links with `componentIds`, preserving order
 * (display_order = array index). Requires a service-role client.
 */
export async function upsertBundleItems(
  admin: SupabaseClient,
  bundleId: string,
  componentIds: string[],
): Promise<void> {
  await admin.from('bundle_items').delete().eq('bundle_product_id', bundleId);

  if (componentIds.length === 0) return;

  const rows = componentIds.map((component_product_id, display_order) => ({
    bundle_product_id: bundleId,
    component_product_id,
    display_order,
  }));

  const { error } = await admin.from('bundle_items').insert(rows);
  if (error) throw error;
}
