/**
 * Membership guard for the Stripe webhook retriable-events set.
 *
 * The route returns 500 (forcing a Stripe redelivery) only when
 * `RETRIABLE_EVENTS.has(event.type)` and the handler returned
 * `{ processed: false }` (or threw). Anything not in the set is
 * silently 200-OK'd to Stripe and never retried.
 *
 * Source-of-truth events (revenue, access grant, access revocation)
 * MUST be in the set so a transient DB blip does not leave the
 * customer paid-without-access or revoked-without-revocation.
 */
import { describe, it, expect } from 'vitest';
import { RETRIABLE_EVENTS } from '@/app/api/webhooks/stripe/retriable-events';

describe('Stripe webhook retriable events', () => {
  it('forces retry on refunds and disputes (revenue + access impact)', () => {
    expect(RETRIABLE_EVENTS.has('charge.refunded')).toBe(true);
    expect(RETRIABLE_EVENTS.has('charge.dispute.created')).toBe(true);
  });

  it('forces retry on subscription deletion (access revocation must complete)', () => {
    expect(RETRIABLE_EVENTS.has('customer.subscription.deleted')).toBe(true);
  });

  it('forces retry on subscription update (only signal for default-dunning terminal transitions)', () => {
    // Stripe's default dunning marks the subscription as 'unpaid' and never
    // emits customer.subscription.deleted; the update event is the sole
    // signal for that revocation path.
    expect(RETRIABLE_EVENTS.has('customer.subscription.updated')).toBe(true);
  });

  it('forces retry on invoice.paid / invoice.payment_succeeded (source-of-truth grant events)', () => {
    // The grant flow inserts payment_transactions and user_product_access
    // off of these events. A transient failure with a 200-OK response
    // means Stripe never redelivers, leaving the customer paid-without-access
    // (first invoice) or with missing revenue rows (renewals).
    expect(RETRIABLE_EVENTS.has('invoice.paid')).toBe(true);
    expect(RETRIABLE_EVENTS.has('invoice.payment_succeeded')).toBe(true);
  });

  it('does not include events that should always 200-OK (idempotent, recoverable, or no-op)', () => {
    // checkout.session.completed: idempotent + recoverable via the
    // subsequent invoice.paid; double-retry would be redundant.
    expect(RETRIABLE_EVENTS.has('checkout.session.completed')).toBe(false);
    expect(RETRIABLE_EVENTS.has('checkout.session.async_payment_succeeded')).toBe(false);

    // subscription.created is recoverable via the eventual invoice.paid,
    // which is itself retriable.
    expect(RETRIABLE_EVENTS.has('customer.subscription.created')).toBe(false);

    // payment_failed / action_required are best-effort notifications.
    expect(RETRIABLE_EVENTS.has('invoice.payment_failed')).toBe(false);
    expect(RETRIABLE_EVENTS.has('invoice.payment_action_required')).toBe(false);

    // trial_will_end is informational (outbound webhook only).
    expect(RETRIABLE_EVENTS.has('customer.subscription.trial_will_end')).toBe(false);

    // pause/resume are MVP no-ops.
    expect(RETRIABLE_EVENTS.has('customer.subscription.paused')).toBe(false);
    expect(RETRIABLE_EVENTS.has('customer.subscription.resumed')).toBe(false);

    // payment_intent.succeeded mirrors checkout.session.completed for
    // standalone payment intents; same idempotency rationale.
    expect(RETRIABLE_EVENTS.has('payment_intent.succeeded')).toBe(false);
  });
});
