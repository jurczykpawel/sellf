/** Atomic order placement through the service RPC.
 * @see supabase/migrations/20261110235903_release_2026_11_0_orders_events.sql
 * @see supabase/migrations/20261117120000_replace_pending_order.sql (begin/finishPendingOrderUpdate)
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

/** Result of starting a cart update on an open session: the new version, another update in
 * progress (the browser retries), or an order that cannot be updated (a new session is opened). */
export type PendingOrderUpdateStart = { status: 'started'; version: number } | { status: 'busy' } | { status: 'refused' };

/**
 * Store the new cart of a pending online order as the next version and lock the session for this
 * update, before Stripe is called. The saved order itself does not change yet.
 */
export async function beginPendingOrderUpdate(
  client: SupabaseClient<Database>,
  order: OrderInsert,
  lines: OrderSnapshotLine[],
): Promise<PendingOrderUpdateStart> {
  try {
    const { data, error } = await client.rpc('begin_pending_order_update', {
      p_order: order as Json, p_lines: lines as unknown as Json,
    });
    if (error) console.error('[beginPendingOrderUpdate] RPC failed:', error.message);
    const result = !error && data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    if (result.success === true && typeof result.version === 'number') return { status: 'started', version: result.version };
    return result.error === 'update_in_progress' ? { status: 'busy' } : { status: 'refused' };
  } catch (error) {
    console.error('[beginPendingOrderUpdate] Request failed:', error instanceof Error ? error.message : 'Unknown error');
    return { status: 'refused' };
  }
}

/**
 * Release the session after the Stripe call. A confirmed version becomes the saved order; an
 * unconfirmed one is kept so a payment Stripe may still take for it settles. True only when the
 * confirmed version is now the saved order.
 */
export async function finishPendingOrderUpdate(
  client: SupabaseClient<Database>,
  sessionId: string,
  version: number,
  confirmed: boolean,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('finish_pending_order_update', {
      p_session_id: sessionId, p_version: version, p_confirmed: confirmed,
    });
    if (error) console.error('[finishPendingOrderUpdate] RPC failed:', error.message);
    return !error && !!data && typeof data === 'object' && !Array.isArray(data) && data.success === true;
  } catch (error) {
    console.error('[finishPendingOrderUpdate] Request failed:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}
