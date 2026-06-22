/**
 * Single source of truth for the Stripe publishable key (server-side).
 *
 * Prefers `STRIPE_PUBLISHABLE_KEY`, falls back to `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
 *
 * Both the storefront (`runtime-config`) and the embed `checkout.js` loader resolve
 * the key through this helper so they can never diverge. The embed previously read
 * only `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and silently broke on a deployment that
 * set only `STRIPE_PUBLISHABLE_KEY` (the publishable key inlined as `""` →
 * `Stripe("")` → checkout never mounts).
 */
export function getStripePublishableKey(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
}
