/**
 * Cart changes on an open on-site Checkout Session (ui_mode 'elements') update that session
 * instead of opening a new one (W219). Stripe allows replacing `line_items` (the whole array,
 * items without `id` replace the old ones; totals and taxes are recalculated), `metadata` and,
 * for payment mode, `payment_intent_data.metadata`. Language, return URL, mode and the customer
 * email cannot be changed, so a session that differs in those is replaced instead.
 * Discounts are not involved: Sellf prices coupons into the line amounts itself.
 *
 * Every update carries a cart version in the session and PaymentIntent metadata, written in the
 * same Stripe call as the line items, so a payment settles against the cart Stripe charged even
 * when the update fails, times out or races with the payment (W219b). Sessions of another
 * installation are never reused.
 * @see https://docs.stripe.com/payments/checkout/dynamically-update-line-items
 * @see https://docs.stripe.com/api/checkout/sessions/update
 * @see src/app/api/create-payment-intent/route.ts
 * @see supabase/migrations/20261117120000_replace_pending_order.sql (cart versions)
 */
import type Stripe from 'stripe';
import { verifyCheckoutBinding } from '@/lib/security/checkout-binding';
import { isOwnStripeMarker, readStripeInstanceMarker } from '@/lib/stripe/instance-marker';

/** Session/PaymentIntent metadata key holding the cart version Stripe carries. */
export const CART_VERSION_METADATA_KEY = 'sellf_cart_version';

/** Cart version from Stripe metadata; undefined = the cart the order was placed with. */
export function readCartVersion(metadata: Stripe.Metadata | null | undefined): number | undefined {
  const value = metadata?.[CART_VERSION_METADATA_KEY];
  return typeof value === 'string' && /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : undefined;
}

/** A payment attempt Stripe may still complete; changing the session would abandon it. */
const PAYMENT_IN_PROGRESS = new Set(['processing', 'requires_capture', 'requires_action', 'succeeded']);
/** Leave the buyer time to pay after the update. */
const MIN_REMAINING_SECONDS = 120;

export interface ReusableSessionContext {
  clientSecret: unknown;
  bindingToken: unknown;
  productId: string;
  userId: string | null;
  email: string | null;
  locale: string;
  successUrl: string;
}

/** The buyer's own open payment session for the same product, language and email, or null. */
export async function findReusableCheckoutSession(
  stripe: Stripe,
  ctx: ReusableSessionContext,
): Promise<Stripe.Checkout.Session | null> {
  const sessionId = typeof ctx.clientSecret === 'string' ? ctx.clientSecret.split('_secret_')[0] : '';
  if (!/^cs_(test|live)_[a-zA-Z0-9]+$/.test(sessionId) || typeof ctx.bindingToken !== 'string') return null;
  if (!verifyCheckoutBinding(ctx.bindingToken, { stripeObjectId: sessionId, userId: ctx.userId, productId: ctx.productId })) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const metadata = session.metadata ?? {};
    const marker = readStripeInstanceMarker(session);
    if (marker !== null && !await isOwnStripeMarker(marker)) return null;
    const paymentIntent = session.payment_intent;
    const reusable = session.status === 'open' && session.mode === 'payment' && session.ui_mode === 'elements'
      && session.expires_at - Date.now() / 1000 >= MIN_REMAINING_SECONDS
      && metadata.product_id === ctx.productId
      && (metadata.user_id || null) === ctx.userId
      && (metadata.email || '') === (ctx.email || '')
      && session.locale === ctx.locale
      && (metadata.success_url || '') === ctx.successUrl
      && (!paymentIntent || (typeof paymentIntent === 'object' && !PAYMENT_IN_PROGRESS.has(paymentIntent.status)));
    return reusable ? session : null;
  } catch (error) {
    console.error('[findReusableCheckoutSession] Retrieve failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Replace the session's items and metadata (also on its PaymentIntent) with cart `version`. True
 * only when Stripe's answer is this version charging exactly the cart: its metadata carries the
 * version and the updated subtotal equals the sum of the new items.
 */
export async function updateCheckoutSessionCart(
  stripe: Stripe,
  sessionId: string,
  input: { lineItems: Stripe.Checkout.SessionUpdateParams.LineItem[]; metadata: Record<string, string>; expectedSubtotal: number; version: number },
): Promise<boolean> {
  try {
    const metadata = { ...input.metadata, [CART_VERSION_METADATA_KEY]: String(input.version) };
    const updated = await stripe.checkout.sessions.update(sessionId, {
      line_items: input.lineItems,
      metadata,
      payment_intent_data: { metadata },
    });
    if (readCartVersion(updated.metadata) === input.version && updated.amount_subtotal === input.expectedSubtotal) return true;
    console.error(`[updateCheckoutSessionCart] Unconfirmed update: session=${sessionId} version=${updated.metadata?.[CART_VERSION_METADATA_KEY]}/${input.version} stripe=${updated.amount_subtotal} expected=${input.expectedSubtotal}`);
  } catch (error) {
    console.error('[updateCheckoutSessionCart] Update failed:', error instanceof Error ? error.message : 'Unknown error');
  }
  return false;
}
