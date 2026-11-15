/**
 * Shared Stripe account: decide, after the signature check, whether an event belongs to this Sellf
 * installation. Skipped events are acknowledged with 200 so Stripe does not count them as failed
 * deliveries (enough failures and Stripe disables the endpoint).
 *
 * - Marker equal to ours → always processed (the gate never skips our own events).
 * - Marker different from ours → skipped, unless this database has a record bound to the object
 *   (order, pay-link attempt, subscription): then it is ours under a previous marker and processed.
 * - No marker (objects created before markers existed, or by hand in Stripe) → processed as before,
 *   except a one-time payment for a product id, or a pay-link attempt, this database does not know → skip.
 * A database error while deciding throws; the route answers 5xx and Stripe redelivers.
 *
 * @see src/lib/stripe/instance-marker.ts
 */
import type Stripe from 'stripe';
import { isForeignStripeMarker, readStripeInstanceMarker } from '@/lib/stripe/instance-marker';
import { isQuickPayObject } from '@/lib/orders/quick-pay';
import type { createAdminClient } from '@/lib/supabase/admin';

type Db = ReturnType<typeof createAdminClient>;
type Ref = string | { id: string } | null | undefined;
interface GateObject {
  id?: string;
  object?: string;
  metadata?: Record<string, string> | null;
  payment_intent?: Ref;
  subscription?: Ref;
  parent?: { subscription_details?: { subscription?: Ref } | null } | null;
}

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
const idOf = (ref: Ref) => (typeof ref === 'string' ? ref : ref?.id) || null;

async function found(table: string, column: string, value: string, db: Db): Promise<boolean> {
  const { data, error } = await db.from(table as 'payment_transactions').select('id').eq(column as 'id', value).limit(1);
  if (error) throw new Error('Local record lookup unavailable');
  return (data?.length ?? 0) > 0;
}

/** Is there a local order, pay-link attempt or subscription bound to this Stripe object? */
async function hasLocalRecord(object: GateObject, db: Db): Promise<boolean> {
  const sessionId = object.object === 'checkout.session' ? object.id : null;
  const paymentIntentId = object.object === 'payment_intent' ? object.id : idOf(object.payment_intent);
  const subscriptionId = object.object === 'subscription'
    ? object.id : idOf(object.subscription) ?? idOf(object.parent?.subscription_details?.subscription);
  const attemptId = object.metadata?.sellf_payment_attempt;
  const lookups: Array<[string, string, string | null | undefined]> = [
    ['payment_transactions', 'session_id', sessionId],
    ['order_payment_attempts', 'stripe_session_id', sessionId],
    ['payment_transactions', 'stripe_payment_intent_id', paymentIntentId],
    ['payment_transactions', 'session_id', paymentIntentId],
    ['order_payment_attempts', 'stripe_payment_intent_id', paymentIntentId],
    ['order_payment_attempts', 'id', attemptId && UUID.test(attemptId) ? attemptId : null],
    ['subscriptions', 'stripe_subscription_id', subscriptionId],
  ];
  for (const [table, column, value] of lookups) {
    if (value && await found(table, column, value, db)) return true;
  }
  return false;
}

export async function gateEventByInstance(event: Stripe.Event, db: Db): Promise<InstanceGateResult> {
  const object = event.data.object as GateObject;
  const marker = readStripeInstanceMarker(object);
  if (marker) {
    if (!await isForeignStripeMarker(marker)) return PROCESS;
    if (!await hasLocalRecord(object, db)) return skip('foreign instance, skipped');
    console.warn(`[Stripe Webhook] ${event.type} (${event.id}): marker mismatch, local record found`);
    return PROCESS;
  }
  if (QUICK_PAY_EVENTS.has(event.type) && isQuickPayObject(object)) {
    const attemptId = object.metadata!.sellf_payment_attempt;
    return UUID.test(attemptId) && await found('order_payment_attempts', 'id', attemptId, db)
      ? PROCESS : skip('unmarked quick pay attempt unknown here, skipped');
  }
  if (!ONE_TIME_COMPLETION_EVENTS.has(event.type)) return PROCESS;
  const productId = object.metadata?.product_id;
  if (!productId) return PROCESS;
  return UUID.test(productId) && await found('products', 'id', productId, db)
    ? PROCESS : skip('unmarked event for an unknown product, skipped');
}
