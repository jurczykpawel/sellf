/** Atomic order placement through the service RPC.
 * @see supabase/migrations/20261022192147_order_placement.sql
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderSnapshotLine } from '@/lib/services/checkout-line-items';
import type { Database, Json } from '@/types/database';

export async function placeOrder(
  client: SupabaseClient<Database>,
  order: Database['public']['Tables']['payment_transactions']['Insert'],
  lines: OrderSnapshotLine[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await client.rpc('place_order', {
      p_order: order as Json, p_lines: lines as unknown as Json,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
      return { success: false, error: 'Order placement failed' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Order placement failed' };
  }
}
