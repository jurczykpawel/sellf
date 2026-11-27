/**
 * Bundle component persistence.
 *
 * A bundle product (products.is_bundle = true) links to its component products
 * through the `bundle_items` junction table. The products API replaces the whole
 * ordered set on each write through one database transaction, with
 * display_order = array index.
 *
 * Component validity (no nested bundles, no subscriptions, parent must be a
 * bundle) is enforced by the `bundle_items` validation trigger — an invalid
 * component makes the insert throw, which the caller surfaces as an API error.
 *
 * @see supabase/migrations (bundle_items table + validation trigger)
 * @see ../../app/api/v1/products/route.ts (create wiring)
 * @see ../../app/api/v1/products/[id]/route.ts (update wiring)
 */

import { ApiValidationError } from '@/lib/api/errors';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ARCHIVED_BUNDLE_MESSAGE = 'Restore the bundle from the archive before editing its contents';
/** `error.details.code` of the 409 answer, so clients can word the refusal themselves (api.md). */
export const ARCHIVED_BUNDLE_DETAILS = { code: ['bundle_archived'] };

/** The bundle is archived, so its composition is frozen (api.md: archive rules). */
export class BundleArchivedError extends Error {
  constructor() {
    super(ARCHIVED_BUNDLE_MESSAGE);
    this.name = 'BundleArchivedError';
  }
}

/**
 * Replace a bundle's component links with `componentIds`, preserving order
 * (display_order = array index). Requires a service-role client.
 * Throws BundleArchivedError when the bundle is archived.
 */
export async function upsertBundleItems(
  admin: SupabaseClient,
  bundleId: string,
  componentIds: string[],
): Promise<void> {
  const { error } = await admin.rpc('replace_bundle_items', {
    p_bundle_id: bundleId,
    p_component_ids: componentIds,
  });
  if (error) {
    if (error.details === 'bundle_archived') throw new BundleArchivedError();
    if (error.details === 'bundle_component_archived') {
      throw new ApiValidationError(error.message, { bundleItemIds: ['archived'] });
    }
    throw error;
  }
}
