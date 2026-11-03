/**
 * Server helpers that hand checkout attribution to the database.
 *
 * Paid flows store the payload under every checkout reference they know (Stripe session /
 * intent / subscription id and the order reference written to metadata `sf_attr_ref`); the
 * payment_transactions trigger turns it into an immutable snapshot when the order becomes a
 * purchase. Free grants are recorded directly. Attribution never blocks a checkout: errors are
 * logged and swallowed.
 *
 * @see supabase/migrations/20261103120000_purchase_attribution.sql
 */

import { createHash } from 'node:crypto';
import { normalizeAttribution } from '@/lib/attribution/normalize';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttributionRequestContext } from '@/lib/attribution/normalize';
import type { Database, Json } from '@/types/database';

type Db = Pick<SupabaseClient<Database>, 'rpc'>;

/** Metadata key linking an order (Stripe metadata / payment_transactions.metadata) to its pending attribution. */
export const ATTRIBUTION_REF_KEY = 'sf_attr_ref';

export function attributionRequestContext(headers: Headers): AttributionRequestContext {
  return {
    userAgent: headers.get('user-agent'),
    country: headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country'),
  };
}

export async function storeCheckoutAttribution(
  db: Db,
  refs: Array<string | null | undefined>,
  raw: unknown,
  ctx: AttributionRequestContext,
): Promise<void> {
  const payload = normalizeAttribution(raw, ctx) as unknown as Json;
  const unique = [...new Set(refs.filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 255))];
  await Promise.all(unique.map(async (ref) => {
    try {
      const { error } = await db.rpc('store_checkout_attribution', { p_ref: ref, p_payload: payload });
      if (error) console.error('[storeCheckoutAttribution] Error:', error.message);
    } catch (error) {
      console.error('[storeCheckoutAttribution] Error:', error instanceof Error ? error.message : 'Unknown error');
    }
  }));
}

export async function recordFreeAttribution(
  db: Db,
  productId: string,
  userId: string,
  raw: unknown,
  ctx: AttributionRequestContext,
): Promise<void> {
  try {
    const { error } = await db.rpc('record_free_attribution', {
      p_product: productId, p_user: userId, p_payload: normalizeAttribution(raw, ctx) as unknown as Json,
    });
    if (error) console.error('[recordFreeAttribution] Error:', error.message);
  } catch (error) {
    console.error('[recordFreeAttribution] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Reference for a guest free signup: the grant happens later, after the magic link, so the
 * pending payload is keyed by product + a hash of the e-mail (the e-mail itself is not stored).
 */
export function freeAttributionRef(productSlug: string, email: string): string {
  return `free:${productSlug}:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}

/** Turns a pending guest free-signup source into the free-access snapshot once access is granted. */
export async function claimFreeAttribution(
  db: Db,
  productId: string,
  userId: string,
  productSlug: string,
  email: string,
): Promise<void> {
  try {
    const { error } = await db.rpc('record_free_attribution_from_ref', {
      p_product: productId, p_user: userId, p_ref: freeAttributionRef(productSlug, email),
    });
    if (error) console.error('[claimFreeAttribution] Error:', error.message);
  } catch (error) {
    console.error('[claimFreeAttribution] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}
