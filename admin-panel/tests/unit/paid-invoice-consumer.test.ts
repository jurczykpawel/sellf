/** A receiver must be able to confirm the period actually paid by this invoice. */
import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import recorded from '../fixtures/stripe/invoice_paid_cycle.json';
import { extractSubscriptionId } from '@/app/api/webhooks/stripe/subscription-handlers';
import { buildInvoicePaidPayload } from '@/lib/services/subscription-webhook-payload';

const invoice = recorded.data.object;
const subscriptionId = invoice.parent.subscription_details.subscription;
const paidLine = invoice.lines.data[0];
const customer = { email: '', userId: 'customer-binding' };
const product = { id: 'product-binding', name: 'Monthly', slug: 'monthly', currency: 'PLN' };
function build(value: unknown) {
  return buildInvoicePaidPayload({ invoice: value as Stripe.Invoice, subscriptionId, customer, product });
}
function paidAccessEnd(payload: ReturnType<typeof build>): string | null {
  return payload.invoice.stripeInvoiceId && payload.subscription.stripeSubscriptionId
    && payload.customer.userId && payload.product.id && payload.invoice.paidAt
    && payload.invoice.amountPaid > 0 && payload.subscription.currentPeriodStart
    && payload.subscription.currentPeriodEnd || null;
}

describe('recorded subscription-cycle invoice consumer', () => {
  it('can renew access to the exact paid period from the outgoing payload @J36', () => {
    const payload = build(invoice);
    expect(invoice.billing_reason).toBe('subscription_cycle');
    expect(paidAccessEnd(payload)).toBe(new Date(paidLine.period.end * 1000).toISOString());
    expect(payload.subscription.currentPeriodStart).toBe(new Date(paidLine.period.start * 1000).toISOString());
    expect(payload.invoice).toMatchObject({ stripeInvoiceId: invoice.id,
      amountPaid: invoice.amount_paid / 100, currency: invoice.currency.toUpperCase(),
      paidAt: new Date(invoice.status_transitions.paid_at * 1000).toISOString() });
    expect(payload.subscription.stripeSubscriptionId).toBe(subscriptionId);
  });
  it.each(['missing-lines', 'empty-lines', 'other-subscription', 'proration', 'invalid-period', 'missing-parent', 'ambiguous-lines', 'truncated-lines'])
    ('does not confirm an unproven paid period: %s @J36', (variant) => {
      const modified = structuredClone(invoice);
      switch (variant) {
        case 'missing-lines': Reflect.deleteProperty(modified, 'lines'); break;
        case 'empty-lines': modified.lines.data = []; break;
        case 'other-subscription': modified.lines.data[0].parent.subscription_item_details.subscription = 'sub_other'; break;
        case 'proration': modified.lines.data[0].parent.subscription_item_details.proration = true; break;
        case 'invalid-period': modified.lines.data[0].period.end = modified.lines.data[0].period.start - 1; break;
        case 'missing-parent': Reflect.deleteProperty(modified.lines.data[0], 'parent'); break;
        case 'truncated-lines': modified.lines.has_more = true; break;
        case 'ambiguous-lines': modified.lines.data.push(structuredClone(paidLine)); break;
      }
      const payload = build(modified);
      expect(paidAccessEnd(payload)).toBeNull();
      expect(payload.subscription).not.toHaveProperty('currentPeriodEnd');
      expect(payload.subscription).not.toHaveProperty('currentPeriodStart');
    });
});

it('retains the subscription binding from a recorded modern line when the optional invoice parent is absent', () => {
  const value = structuredClone(invoice);
  Reflect.deleteProperty(value, 'parent');
  expect(extractSubscriptionId(value as unknown as Stripe.Invoice)).toBe(subscriptionId);
});
