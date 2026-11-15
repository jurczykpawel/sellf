/**
 * Stripe instance marker: every Checkout Session, PaymentIntent, Subscription and Refund that Sellf
 * creates carries `metadata.sellf_instance`, so several Sellf installations can share one Stripe
 * account (or sandbox) and the webhook can acknowledge and skip events that belong to another one.
 *
 * The value is derived from the per-installation random id in `telemetry_state` (seeded once by
 * migration 20260627120000_telemetry.sql, kept across restarts and upgrades). It is hashed with a
 * fixed label so the Stripe-visible value does not reveal the anonymous telemetry id.
 * It is not a domain and holds no personal data.
 *
 * @see src/app/api/webhooks/stripe/instance-gate.ts (webhook side)
 * @see src/lib/telemetry/identity.ts
 */
import { createHash } from 'node:crypto';
import { readInstanceId } from '@/lib/telemetry/identity';

export const STRIPE_INSTANCE_METADATA_KEY = 'sellf_instance';

let cached: Promise<string> | null = null;

/** Stable Stripe marker of this installation. Throws when the database cannot be read. */
export function getStripeInstanceId(): Promise<string> {
  cached ??= readInstanceId()
    .then((id) => createHash('sha256').update(`sellf-stripe-instance:${id}`).digest('hex').slice(0, 32))
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached;
}

/** Metadata entry to spread into any Stripe create payload. */
export async function stripeInstanceMetadata(): Promise<Record<typeof STRIPE_INSTANCE_METADATA_KEY, string>> {
  return { [STRIPE_INSTANCE_METADATA_KEY]: await getStripeInstanceId() };
}

interface MetadataCarrier {
  metadata?: Record<string, string> | null;
  parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null;
}

/**
 * Marker on a webhook event object. Invoices carry the subscription's metadata snapshot under
 * parent.subscription_details (their own metadata is empty for subscription invoices).
 */
export function readStripeInstanceMarker(object: unknown): string | null {
  const carrier = (object ?? {}) as MetadataCarrier;
  const value = carrier.metadata?.[STRIPE_INSTANCE_METADATA_KEY]
    ?? carrier.parent?.subscription_details?.metadata?.[STRIPE_INSTANCE_METADATA_KEY];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
