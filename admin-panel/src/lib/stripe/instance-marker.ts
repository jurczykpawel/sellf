/**
 * Stripe instance marker: every Checkout Session, PaymentIntent, Subscription and Refund that Sellf
 * creates carries `metadata.sellf_instance`, so several Sellf installations can share one Stripe
 * account (or sandbox) and the webhook can acknowledge and skip events that belong to another one.
 *
 * The value is derived from `SELLF_INSTANCE_ID` when set (a restored copy of a database must set its
 * own before start, or it would act as the original), otherwise from the per-installation random id in
 * `telemetry_state` (seeded once by migration 20260627120000_telemetry.sql, kept across restarts and
 * upgrades). It is hashed with a fixed label so the Stripe-visible value does not reveal the source.
 * It is not a domain and holds no personal data.
 *
 * @see src/app/api/webhooks/stripe/instance-gate.ts (webhook side)
 * @see src/lib/telemetry/identity.ts
 */
import { createHash } from 'node:crypto';
import { readInstanceId } from '@/lib/telemetry/identity';

export const STRIPE_INSTANCE_METADATA_KEY = 'sellf_instance';
const INSTANCE_ID_ENV_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

let cached: Promise<string> | null = null;

const markerOf = (source: string) => createHash('sha256').update(`sellf-stripe-instance:${source}`).digest('hex').slice(0, 32);

function instanceIdFromEnv(): string | null {
  const value = process.env.SELLF_INSTANCE_ID?.trim();
  if (!value) return null;
  if (!INSTANCE_ID_ENV_FORMAT.test(value)) throw new Error('Invalid SELLF_INSTANCE_ID: use 8-64 characters A-Z, a-z, 0-9, "_" or "-"');
  return value;
}

/** Stable Stripe marker of this installation. Throws when SELLF_INSTANCE_ID is malformed or the database cannot be read. */
export async function getStripeInstanceId(): Promise<string> {
  const override = instanceIdFromEnv();
  if (override) return markerOf(`env:${override}`);
  cached ??= readInstanceId()
    .then(markerOf)
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

/** True when the object carries another installation's marker (no marker → false). */
export async function isForeignStripeMarker(marker: string | null): Promise<boolean> {
  return marker !== null && marker !== await getStripeInstanceId();
}
