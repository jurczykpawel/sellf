/** Resolve event pricing and visitor hold limits before creating Stripe checkout.
 * @see supabase/migrations/20261023080000_event_reservations.sql
 */
import { z } from 'zod';
import { validateUUID } from '@/lib/validations/product';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const sessionSchema = z.object({
  id: z.string(), title: z.string().nullable(), starts_at: z.string(), remaining: z.number().nullable(),
  current_tier: z.object({ id: z.string(), price: z.number().nonnegative(), seats_left: z.number().nullable() }).nullable(),
});

export async function resolveEventCheckout(
  db: SupabaseClient<Database>,
  input: { productId: string; sessionId: unknown; email: string | null; ip: string; quantity: number },
): Promise<{ success: true; price: number; sessionId: string } | { success: false; status: number; error: string }> {
  if (typeof input.sessionId !== 'string' || !validateUUID(input.sessionId).isValid || !input.email) {
    return { success: false, status: 400, error: 'Event session and email are required' };
  }
  const { data, error } = await db.rpc('event_availability', { p_product_id: input.productId });
  const parsed = z.array(sessionSchema).safeParse(data);
  if (error || !parsed.success) return { success: false, status: 503, error: 'Event availability unavailable' };
  const session = parsed.data.find(s => s.id === input.sessionId);
  const tier = session?.current_tier;
  if (!tier || (session.remaining !== null && session.remaining < input.quantity)
    || (tier.seats_left !== null && tier.seats_left < input.quantity)) {
    return { success: false, status: 409, error: 'sold_out' };
  }
  const limits = await db.rpc('event_hold_limits', { p_session_id: input.sessionId, p_email: input.email, p_ip: input.ip });
  if (limits.error) return { success: false, status: 503, error: 'Event availability unavailable' };
  if (limits.data !== true) return { success: false, status: 429, error: 'event_hold_limit' };
  return { success: true, price: tier.price, sessionId: session.id };
}
