/**
 * Shared bundle-order helpers for the purchase-completion emitters.
 *
 * Both `purchase.completed` emitters — the Stripe-webhook handlers
 * (`src/app/api/webhooks/stripe/onetime-handlers.ts`) and the buyer-redirect
 * confirmation path (`src/lib/payment/verify-payment.ts`) — are gated on the same
 * idempotent completion RPC + `!already_had_access` guard, so whichever wins the
 * completion race emits the event. They MUST therefore produce an identical bundle
 * payload shape: `componentProductIds` resolved from `bundle_items`, a license per
 * licensable product in `[productId, ...componentProductIds]`, and scoping widened
 * to include the component ids. These helpers are the single source of that logic.
 *
 * @see src/app/api/webhooks/stripe/onetime-handlers.ts
 * @see src/lib/payment/verify-payment.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { issueLicense } from '@/lib/license-keys/issue';
import type { PurchaseWebhookData } from '@/lib/services/webhook-payload';

type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Resolve a bundle's component product ids (ordered by display_order). Returns [] for a
 * non-bundle product (no rows) or on a query error — a bundle purchase still grants the
 * bundle itself, so this is fail-safe and never blocks the purchase.completed emitter.
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
    return [];
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
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
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
