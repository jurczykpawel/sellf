/**
 * Shared bundle-order helpers for the purchase-completion emitters.
 *
 * All completion paths resume license issuance and durable endpoint delivery from
 * the canonical transaction. Licenses are idempotent per order/product and each
 * endpoint delivery is deduplicated independently by the webhook queue.
 *
 * @see src/app/api/webhooks/stripe/onetime-handlers.ts
 * @see src/lib/payment/verify-payment.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { issueLicense } from '@/lib/license-keys/issue';
import type { PurchaseWebhookData } from '@/lib/services/webhook-payload';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';

type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Resolve a bundle's component product ids (ordered by display_order). Returns [] for a
 * non-bundle product (no rows). Query failures request another fulfillment attempt.
 */
export async function resolveComponentProductIds(
  supabase: AnySupabaseClient,
  productId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('bundle_items')
    .select('component_product_id')
    .eq('bundle_product_id', productId)
    .order('display_order', { ascending: true });
  if (error) {
    console.error('[bundle-order] Failed to resolve bundle component ids:', error);
    throw new Error('Bundle components unavailable');
  }
  return (data ?? []).map((r: { component_product_id: string }) => r.component_product_id);
}

/**
 * Issue a license for every licensable product in the order (`[productId, ...componentIds]`)
 * and return the collected `licenses[]`. Idempotent per (order_id, product_id) via issueLicense;
 * products without issuance enabled simply yield no entry.
 */
export async function issueLicensesForOrder(
  supabase: AnySupabaseClient,
  args: {
    productIds: string[];
    email: string;
    userId: string | null;
    orderId: string;
    customFieldValues?: Record<string, string>;
  },
): Promise<NonNullable<PurchaseWebhookData['licenses']>> {
  const siteUrl = getCanonicalOriginOrNull() ?? '';
  const licenses: NonNullable<PurchaseWebhookData['licenses']> = [];
  for (const pid of args.productIds) {
    const res = await issueLicense(supabase, {
      productId: pid,
      email: args.email,
      userId: args.userId,
      orderId: args.orderId,
      customFieldValues: args.customFieldValues,
    });
    if (res) {
      licenses.push({
        productId: pid,
        token: res.token,
        kid: res.kid,
        jwksUrl: `${siteUrl}/api/licenses/jwks?seller=${res.sellerId}`,
      });
    }
  }
  return licenses;
}
