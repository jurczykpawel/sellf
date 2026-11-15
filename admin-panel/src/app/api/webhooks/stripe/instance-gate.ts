/**
 * Shared Stripe account: decide, after the signature check, whether an event belongs to this Sellf
 * installation. Skipped events are acknowledged with 200 so Stripe does not count them as failed
 * deliveries (enough failures and Stripe disables the endpoint).
 *
 * - Marker present and different from ours → another installation's object, skip.
 * - Marker equal to ours → always processed (the gate never skips our own events).
 * - No marker (objects created before markers existed, or by hand in Stripe) → processed as before,
 *   except a one-time payment for a product id this database does not know → skip.
 * A database error while deciding throws, so the route answers 5xx and Stripe redelivers.
 *
 * @see src/lib/stripe/instance-marker.ts
 */
import type Stripe from 'stripe';
import { getStripeInstanceId, readStripeInstanceMarker } from '@/lib/stripe/instance-marker';
import type { createAdminClient } from '@/lib/supabase/admin';

const ONE_TIME_COMPLETION_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'payment_intent.succeeded',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InstanceGateResult = { skip: false } | { skip: true; reason: string };

export async function gateEventByInstance(
  event: Stripe.Event,
  db: ReturnType<typeof createAdminClient>,
): Promise<InstanceGateResult> {
  const object = event.data.object as { metadata?: Record<string, string> | null };
  const marker = readStripeInstanceMarker(object);
  if (marker) {
    return marker === await getStripeInstanceId() ? { skip: false } : { skip: true, reason: 'foreign instance, skipped' };
  }
  if (!ONE_TIME_COMPLETION_EVENTS.has(event.type)) return { skip: false };
  const productId = object.metadata?.product_id;
  if (!productId) return { skip: false };
  if (!UUID.test(productId)) return { skip: true, reason: 'unmarked event for an unknown product, skipped' };
  const { data, error } = await db.from('products').select('id').eq('id', productId).maybeSingle();
  if (error) throw new Error('Product lookup unavailable');
  return data ? { skip: false } : { skip: true, reason: 'unmarked event for an unknown product, skipped' };
}
