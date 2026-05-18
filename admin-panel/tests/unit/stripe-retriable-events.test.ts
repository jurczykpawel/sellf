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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  RETRIABLE_EVENTS,
  TERMINAL_FAILURE_REASONS,
} from '@/app/api/webhooks/stripe/retriable-events';

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

// Terminal failures = permanent data-inconsistency reasons. A retry would
// re-run the same handler with the same broken data; Stripe would loop the
// event for 3 days until heap pressure. The set bypasses the retriable
// gate, draining the queue with a 200 ack.
describe('Stripe webhook terminal failure reasons', () => {
  it('covers product-binding failures (zombie subscriptions)', () => {
    expect(TERMINAL_FAILURE_REASONS.has('Product not found')).toBe(true);
    expect(TERMINAL_FAILURE_REASONS.has('Subscription missing metadata.product_id')).toBe(true);
    expect(TERMINAL_FAILURE_REASONS.has('Stripe price id does not match the bound product')).toBe(true);
  });

  it('covers customer/email failures (orphaned subscriptions)', () => {
    expect(TERMINAL_FAILURE_REASONS.has('Customer is deleted')).toBe(true);
    expect(TERMINAL_FAILURE_REASONS.has('No email on customer')).toBe(true);
  });

  it('covers all invoice-side no-email/no-customer variants', () => {
    // Same root cause as 'No email on customer' but emitted from the
    // invoice-event handlers — each has a slightly different message
    // string so we list them explicitly.
    expect(TERMINAL_FAILURE_REASONS.has('No email on invoice')).toBe(true);
    expect(TERMINAL_FAILURE_REASONS.has('No email on invoice or customer')).toBe(true);
    expect(TERMINAL_FAILURE_REASONS.has('No email on upcoming invoice')).toBe(true);
    expect(TERMINAL_FAILURE_REASONS.has('No customer on upcoming invoice')).toBe(true);
  });

  // Drift guard. If a future handler returns a new 'No email on X' or
  // 'No customer on X' message that isn't added here, retriable events
  // (invoice.paid, invoice.payment_succeeded) loop until OOM. This test
  // greps the source and forces a deliberate decision on every new variant.
  it('drift guard: every "No (email|customer) on X" reason in handlers is on the terminal list', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/app/api/webhooks/stripe/subscription-handlers.ts'),
      'utf-8',
    );
    const pattern = /message:\s*['"`](No (?:email|customer) on [^'"`]+)['"`]/g;
    const reasons = new Set<string>();
    for (const match of source.matchAll(pattern)) {
      reasons.add(match[1]);
    }

    // Sanity: at least the variants we know about must show up — if this
    // breaks, the source moved and the regex needs an update, not the set.
    expect(reasons.size).toBeGreaterThanOrEqual(4);

    const missing = [...reasons].filter(r => !TERMINAL_FAILURE_REASONS.has(r));
    expect(missing, `New no-email/no-customer reasons must be added to TERMINAL_FAILURE_REASONS: ${missing.join(', ')}`).toEqual([]);
  });
});
