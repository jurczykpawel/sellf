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
): Promise<{ success: boolean; error?: string; status?: number }> {
  try {
    const { data, error } = await client.rpc('place_order', {
      p_order: order as Json, p_lines: lines as unknown as Json,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
      if (error?.code === 'P0409') return { success: false, error: error.message === 'event_price_changed' ? 'event_price_changed' : 'sold_out', status: 409 };
      if (error?.code === 'P0429') return { success: false, error: 'event_hold_limit', status: 429 };
      return { success: false, error: 'Order placement failed' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Order placement failed' };
  }
}
