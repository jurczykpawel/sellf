/**
  * product_type immutability guard.
 *
 * Once a product has been sold (any payment_transaction, user_product_access,
 * or subscription row exists), its `product_type` must not change. Existing
 * receipts, invoices, and access rows would silently misrepresent what was
 * delivered.
 *
 * Used by:
 *   - PATCH /api/v1/products/[id] — server-side rejection (HTTP 400)
 *   - SubscriptionSection UI lock — purely advisory
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type AnyClient = SupabaseClient<any, any, any>;

const SOLD_TABLES = ['payment_transactions', 'user_product_access', 'subscriptions'] as const;

export async function hasProductBeenSold(
  supabase: AnyClient,
  productId: string
): Promise<boolean> {
  for (const table of SOLD_TABLES) {
    const { data, error } = await supabase
      .from(table as 'payment_transactions')
      .select('id')
      .eq('product_id', productId)
      .limit(1);
    if (error) {
      console.error(`[hasProductBeenSold] error querying ${table}:`, error);
      // Fail closed: if the check itself errors, deny the type flip.
      return true;
    }
    if (data && data.length > 0) return true;
  }
  return false;
}
