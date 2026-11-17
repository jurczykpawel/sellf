/** Atomic order placement through the service RPC.
 * @see supabase/migrations/20261110235903_release_2026_11_0_orders_events.sql
 * @see supabase/migrations/20261117120000_replace_pending_order.sql (replacePendingOrder)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderSnapshotLine } from '@/lib/services/checkout-line-items';
import type { Database, Json } from '@/types/database';

type OrderInsert = Database['public']['Tables']['payment_transactions']['Insert'];

export async function placeOrder(
  client: SupabaseClient<Database>,
  order: OrderInsert,
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

/**
 * Replace the lines, amount and coupon of a pending online order for the same session, product
 * and buyer (cart change on an open Checkout Session). False when the order is not replaceable
 * (paid, other buyer, event seats) or the lines are invalid; the caller then opens a new session.
 */
export async function replacePendingOrder(
  client: SupabaseClient<Database>,
  order: OrderInsert,
  lines: OrderSnapshotLine[],
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('replace_pending_order', {
      p_order: order as Json, p_lines: lines as unknown as Json,
    });
    if (error) console.error('[replacePendingOrder] RPC failed:', error.message);
    return !error && !!data && typeof data === 'object' && !Array.isArray(data) && data.success === true;
  } catch (error) {
    console.error('[replacePendingOrder] Request failed:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}
