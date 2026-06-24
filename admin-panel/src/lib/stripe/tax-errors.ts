/**
 * Stripe Tax misconfiguration detection.
 *
 * When tax_mode is `stripe_tax` but the seller's Stripe account has no Tax origin / head-office
 * address configured, Stripe rejects PaymentIntent / Checkout Session creation with a
 * StripeInvalidRequestError ("You must have a valid head office address to enable automatic tax
 * calculation ..."). Without handling, the buyer gets a generic 500 on every checkout. We detect
 * it so callers can return a clear, actionable error instead.
 *
 * @see https://dashboard.stripe.com/settings/tax
 */
export function isStripeTaxNotConfiguredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { type?: string; message?: unknown };
  if (e.type !== 'StripeInvalidRequestError') return false;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return (
    msg.includes('head office address') ||
    msg.includes('origin address') ||
    msg.includes('automatic tax')
  );
}
