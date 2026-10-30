/** An immediate cancellation must never extend access through an unpaid renewal. */
import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import canceled from '../fixtures/stripe/subscription_canceled_after_failure.json';
import scheduled from '../fixtures/stripe/subscription_scheduled_cancel.json';
import failed from '../fixtures/stripe/subscription_renewal_failed.json';
import paidInvoice from '../fixtures/stripe/cancellation_paid_invoice.json';
import observed from '../fixtures/stripe/consumer_subscription_canceled_legacy.json';
import { resolvePaidSubscriptionEnd } from '@/app/api/webhooks/stripe/subscription-handlers';
import { buildSubscriptionCanceledPayload, buildSubscriptionUpdatedPayload } from '@/lib/services/subscription-webhook-payload';

const customer = { email: '', userId: 'buyer-binding' };
const product = { id: 'product-binding', name: 'Monthly', slug: 'monthly', currency: 'PLN' };
const input = (value: unknown) => ({ customer, product, subscription: value as Stripe.Subscription });
const actualEnd = new Date(canceled.ended_at * 1000).toISOString();

describe('recorded cancellation receiver', () => {
  it('ends an immediately canceled, failed renewal at ended_at instead of its unpaid billing end @J37', () => {
    expect(failed.status).toBe('past_due');
    expect(canceled.ended_at).toBeLessThan(canceled.items.data[0].current_period_end);
    // The independent receiver recorded the same error: its old endsAt exceeded canceledAt.
    expect(Date.parse(observed.payload.data.subscription.endsAt)).toBeGreaterThan(Date.parse(observed.payload.data.subscription.canceledAt));
    const payload = buildSubscriptionCanceledPayload(input(canceled));
    expect(payload.subscription).toMatchObject({ endsAt: actualEnd, endedAt: actualEnd,
      canceledAt: new Date(canceled.canceled_at * 1000).toISOString() });
  });
  it('does not expose an unpaid billing end as the access end in subscription.updated @J37', () => {
    const payload = buildSubscriptionUpdatedPayload(input(canceled));
    expect(payload.subscription).toMatchObject({ endsAt: actualEnd, endedAt: actualEnd, currentPeriodEnd: actualEnd });
  });
  it('retains the scheduling timestamp separately from the proven paid access end @J139', () => {
    const period = paidInvoice.lines.data[0].period;
    const payload = buildSubscriptionUpdatedPayload({ ...input(scheduled), paidPeriodEnd: period.end });
    expect(payload.subscription).toMatchObject({ endsAt: new Date(period.end * 1000).toISOString(),
      endedAt: null, canceledAt: new Date(scheduled.canceled_at * 1000).toISOString() });
    expect(Date.parse(payload.subscription.endsAt!)).toBeGreaterThan(Date.parse(payload.subscription.canceledAt!));
  });
  it('does not guess a scheduled access end without a paid invoice period @J139', () => {
    const payload = buildSubscriptionUpdatedPayload(input({ ...failed, cancel_at_period_end: true }));
    expect(payload.subscription).toMatchObject({ endsAt: null, currentPeriodEnd: null });
  });
  it('retains an observed immediate canceled_at if optional ended_at and items are absent @J37', () => {
    const sparse = structuredClone(canceled);
    Reflect.deleteProperty(sparse, 'ended_at'); Reflect.deleteProperty(sparse, 'items');
    const payload = buildSubscriptionCanceledPayload(input(sparse));
    expect(payload.subscription.endsAt).toBe(new Date(canceled.canceled_at * 1000).toISOString());
  });
});

it('loads a paid invoice period when scheduled cancellation follows an unpaid renewal @J139', async () => {
  const list = vi.fn().mockResolvedValue({ data: [paidInvoice] });
  const stripe = { invoices: { list } } as unknown as Stripe;
  const subscription = { ...failed, cancel_at_period_end: true } as unknown as Stripe.Subscription;
  expect(await resolvePaidSubscriptionEnd(subscription, stripe)).toBe(paidInvoice.lines.data[0].period.end);
  expect(list).toHaveBeenCalledWith({ subscription: failed.id, status: 'paid', limit: 10 });
});
