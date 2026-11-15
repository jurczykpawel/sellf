/**
 * Shared Stripe account: decide, after the signature check, whether an event belongs to this Sellf
 * installation. Skipped events are acknowledged with 200 so Stripe does not count them as failed
 * deliveries (enough failures and Stripe disables the endpoint).
 *
 * - Marker ours (current or listed in SELLF_INSTANCE_ALIASES) → always processed.
 * - Any other marker → skipped, without reading the database. A local copy of the order or subscription
 *   does not make it ours: a restored copy of the database must not fulfil the original's payments.
 * - No marker (objects created before markers existed, or by hand in Stripe) → processed as before,
 *   except a one-time payment for a product id, or a pay-link attempt, this database does not know → skip.
 * A database or configuration error while deciding throws; the route answers 5xx and Stripe redelivers.
 *
 * @see src/lib/stripe/instance-marker.ts
 */
import type Stripe from 'stripe';
import { isForeignStripeMarker, readStripeInstanceMarker } from '@/lib/stripe/instance-marker';
import { isQuickPayObject } from '@/lib/orders/quick-pay';
import type { createAdminClient } from '@/lib/supabase/admin';

type Db = ReturnType<typeof createAdminClient>;
interface GateObject { metadata?: Record<string, string> | null }

const ONE_TIME_COMPLETION_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'payment_intent.succeeded',
]);
const QUICK_PAY_EVENTS: ReadonlySet<string> = new Set([...ONE_TIME_COMPLETION_EVENTS, 'checkout.session.expired']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InstanceGateResult = { skip: false } | { skip: true; reason: string };
const PROCESS: InstanceGateResult = { skip: false };
const skip = (reason: string): InstanceGateResult => ({ skip: true, reason });

async function found(table: 'products' | 'order_payment_attempts', id: string, db: Db): Promise<boolean> {
  const { data, error } = await db.from(table).select('id').eq('id', id).limit(1);
  if (error) throw new Error('Local record lookup unavailable');
  return (data?.length ?? 0) > 0;
}

export async function gateEventByInstance(event: Stripe.Event, db: Db): Promise<InstanceGateResult> {
  const object = event.data.object as GateObject;
  const marker = readStripeInstanceMarker(object);
  if (marker) return await isForeignStripeMarker(marker) ? skip('foreign instance, skipped') : PROCESS;
  if (QUICK_PAY_EVENTS.has(event.type) && isQuickPayObject(object)) {
    const attemptId = object.metadata!.sellf_payment_attempt;
    return UUID.test(attemptId) && await found('order_payment_attempts', attemptId, db)
      ? PROCESS : skip('unmarked quick pay attempt unknown here, skipped');
  }
  if (!ONE_TIME_COMPLETION_EVENTS.has(event.type)) return PROCESS;
  const productId = object.metadata?.product_id;
  if (!productId) return PROCESS;
  return UUID.test(productId) && await found('products', productId, db)
    ? PROCESS : skip('unmarked event for an unknown product, skipped');
}
