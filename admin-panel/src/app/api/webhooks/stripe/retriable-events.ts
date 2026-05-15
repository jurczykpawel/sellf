/**
 * Stripe webhook event types that MUST trigger a Stripe redelivery
 * when their handler fails to process.
 *
 * The route returns 500 (forcing Stripe to retry) only when an event
 * is in this set and the handler returned `{ processed: false }` or
 * threw. Anything outside this set is silently 200-OK'd to Stripe and
 * never redelivered.
 *
 * Membership rules:
 *   - source-of-truth events (revenue rows, access grant, access
 *     revocation) belong here — a transient failure must not leave
 *     the customer paid-without-access or revoked-without-revocation
 *   - events that are recoverable from a later event (e.g.
 *     subscription.created is recoverable from invoice.paid) do NOT
 *     belong here, because the later event is itself retriable
 *   - idempotent or no-op events do NOT belong here
 *
 * Handlers referenced from this set must be idempotent on replay.
 *
 * @see src/app/api/webhooks/stripe/route.ts
 * @see src/app/api/webhooks/stripe/subscription-handlers.ts (early-exits in handleInvoicePaid)
 */
export const RETRIABLE_EVENTS: ReadonlySet<string> = new Set<string>([
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'charge.dispute.created',
  // Subscription cancellations revoke access. Don't silently 200 if the
  // handler couldn't complete — let Stripe retry.
  'customer.subscription.deleted',
  // customer.subscription.updated is the only signal Stripe sends for the
  // default-dunning terminal transition (mark-as-unpaid never fires
  // customer.subscription.deleted). The handler must escalate revoke
  // failures so a redelivery lands; idempotent grant/revoke helpers make
  // a redelivery safe even on the no-op path.
  'customer.subscription.updated',
  // invoice.paid / invoice.payment_succeeded are the source of truth for
  // payment_transactions + user_product_access. Idempotency is enforced
  // by the existing-row early-exit and the 23505 race handler in
  // subscription-handlers.ts, so a redelivery is at worst a no-op.
  'invoice.paid',
  'invoice.payment_succeeded',
]);

// Terminal failures: handler returned processed:false but the cause is a
// permanent data inconsistency (no point in Stripe retrying). Ack with 200
// so the webhook queue drains instead of looping until heap OOM.
export const TERMINAL_FAILURE_REASONS: ReadonlySet<string> = new Set<string>([
  'Product not found',
  'Subscription missing metadata.product_id',
  'Stripe price id does not match the bound product',
  'No email on customer',
  'Customer is deleted',
]);
