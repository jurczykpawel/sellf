/**
 * subscription-webhook-payload (Phase 3 — Subscriptions MVP)
 *
 * Pure unit tests. Uses minimal Stripe-shaped fixtures (cast as Stripe types).
 */

import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  buildSubscriptionCreatedPayload,
  buildSubscriptionUpdatedPayload,
  buildSubscriptionCanceledPayload,
  buildSubscriptionTrialEndingPayload,
  buildInvoicePaidPayload,
  buildInvoicePaymentFailedPayload,
} from '@/lib/services/subscription-webhook-payload';

const customer = { email: 'sub@test.local', userId: 'user-1' };
const product = {
  id: 'prod-1',
  name: 'Monthly',
  slug: 'monthly',
  currency: 'PLN',
  recurring_price: 49,
  billing_interval: 'month',
  billing_interval_count: 1,
};

function makeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_123',
    customer: 'cus_abc',
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    items: {
      data: [
        {
          price: { unit_amount: 4900, recurring: { interval: 'month', interval_count: 1 } },
          current_period_start: 1714435200, // 2024-04-30
          current_period_end: 1717113600,   // 2024-05-31
        } as unknown as Stripe.SubscriptionItem,
      ],
    } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
    ...overrides,
  } as Stripe.Subscription;
}

function makeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: 'in_123',
    amount_paid: 4900,
    amount_due: 4900,
    currency: 'pln',
    hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
    invoice_pdf: 'https://invoice.stripe.com/i/abc/pdf',
    status_transitions: { paid_at: 1717200000 },
    billing_reason: 'subscription_cycle',
    attempt_count: 1,
    next_payment_attempt: null,
    ...overrides,
  } as Stripe.Invoice;
}

describe('subscription-webhook-payload', () => {
  describe('buildSubscriptionCreatedPayload', () => {
    it('extracts plan + period + customer', () => {
      const payload = buildSubscriptionCreatedPayload({
        customer,
        product,
        subscription: makeSubscription({ status: 'trialing', trial_end: 1717113600 }),
      });
      expect(payload.subscription.stripeSubscriptionId).toBe('sub_123');
      expect(payload.subscription.stripeCustomerId).toBe('cus_abc');
      expect(payload.subscription.status).toBe('trialing');
      expect(payload.subscription.recurringPrice).toBe(49);
      expect(payload.subscription.billingInterval).toBe('month');
      expect(payload.subscription.billingIntervalCount).toBe(1);
      expect(payload.subscription.trialEnd).toBe(new Date(1717113600 * 1000).toISOString());
      expect(payload.subscription.currentPeriodEnd).toBe(new Date(1717113600 * 1000).toISOString());
    });

    it('handles object-shaped customer', () => {
      const payload = buildSubscriptionCreatedPayload({
        customer,
        product,
        subscription: makeSubscription({ customer: { id: 'cus_xyz' } as Stripe.Customer }),
      });
      expect(payload.subscription.stripeCustomerId).toBe('cus_xyz');
    });
  });

  describe('buildSubscriptionUpdatedPayload', () => {
    it('includes previousAttributes when provided', () => {
      const payload = buildSubscriptionUpdatedPayload({
        customer,
        product,
        subscription: makeSubscription({ status: 'active' }),
        previousAttributes: { status: 'trialing' },
      });
      expect(payload.subscription.status).toBe('active');
      expect(payload.subscription.previousAttributes).toEqual({ status: 'trialing' });
    });

    it('defaults previousAttributes to empty object', () => {
      const payload = buildSubscriptionUpdatedPayload({
        customer,
        product,
        subscription: makeSubscription(),
      });
      expect(payload.subscription.previousAttributes).toEqual({});
    });
  });

  describe('buildSubscriptionCanceledPayload', () => {
    it('emits canceled metadata', () => {
      const payload = buildSubscriptionCanceledPayload({
        customer,
        product,
        subscription: makeSubscription({
          status: 'canceled',
          canceled_at: 1717200000,
          cancel_at_period_end: true,
        }),
      });
      expect(payload.subscription.status).toBe('canceled');
      expect(payload.subscription.cancelAtPeriodEnd).toBe(true);
      expect(payload.subscription.canceledAt).toBe(new Date(1717200000 * 1000).toISOString());
    });
  });

  describe('buildSubscriptionTrialEndingPayload', () => {
    it('exposes trialEnd', () => {
      const payload = buildSubscriptionTrialEndingPayload({
        customer,
        product,
        subscription: makeSubscription({ trial_end: 1717200000 }),
      });
      expect(payload.subscription.trialEnd).toBe(new Date(1717200000 * 1000).toISOString());
    });
  });

  describe('buildInvoicePaidPayload', () => {
    it('shapes invoice fields correctly', () => {
      const payload = buildInvoicePaidPayload({
        customer,
        product,
        subscriptionId: 'sub_123',
        invoice: makeInvoice(),
      });
      expect(payload.invoice.stripeInvoiceId).toBe('in_123');
      expect(payload.invoice.amountPaid).toBe(49);
      expect(payload.invoice.currency).toBe('PLN');
      expect(payload.invoice.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/abc');
      expect(payload.invoice.billingReason).toBe('subscription_cycle');
    });

    it('includes buyer faktura details snapshotted on the invoice (B2B) — from invoice, not profile', () => {
      const payload = buildInvoicePaidPayload({
        customer,
        product,
        subscriptionId: 'sub_123',
        invoice: makeInvoice({
          customer_name: 'Firma Sp. z o.o.',
          customer_tax_ids: [{ type: 'eu_vat', value: 'PL1181697228' }],
          customer_address: { line1: 'ul. Przykładowa 123', city: 'Warszawa', postal_code: '00-000', country: 'PL' },
        } as unknown as Partial<Stripe.Invoice>),
      });
      expect(payload.invoice).toMatchObject({
        nip: 'PL1181697228', companyName: 'Firma Sp. z o.o.',
        address: 'ul. Przykładowa 123', city: 'Warszawa', postalCode: '00-000', country: 'PL',
      });
    });

    it('omits faktura details for B2C (no tax id on the invoice)', () => {
      const payload = buildInvoicePaidPayload({ customer, product, subscriptionId: 'sub_123', invoice: makeInvoice() });
      expect((payload.invoice as { nip?: string }).nip).toBeUndefined();
    });
  });

  describe('buildInvoicePaymentFailedPayload', () => {
    it('shapes failure fields correctly', () => {
      const payload = buildInvoicePaymentFailedPayload({
        customer,
        product,
        subscriptionId: 'sub_123',
        subscriptionStatus: 'past_due',
        invoice: makeInvoice({ next_payment_attempt: 1717286400, attempt_count: 2 }),
      });
      expect(payload.subscription.status).toBe('past_due');
      expect(payload.invoice.amountDue).toBe(49);
      expect(payload.invoice.attemptCount).toBe(2);
      expect(payload.invoice.nextPaymentAttempt).toBe(new Date(1717286400 * 1000).toISOString());
    });
  });
});
