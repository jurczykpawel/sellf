/** Local product bindings distinguish delayed payment storage from other installations. */
import { describe, expect, it, vi } from 'vitest';
import payment from '../fixtures/stripe/dispute_payment_intent_won.json';
import session from '../fixtures/stripe/checkout_completed_receiver.json';
import invoice from '../fixtures/stripe/invoice_expanded_payments.json';
import subscription from '../fixtures/stripe/subscription_before_cancel.json';
import { pendingPaymentResult } from '@/lib/stripe/pending-payment';
import type Stripe from 'stripe';
import type { createAdminClient } from '@/lib/supabase/admin';

function clients(known = true, intent: unknown = payment) {
  const retrieve = vi.fn().mockResolvedValue(intent);
  const stripe = { paymentIntents: { retrieve }, checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }) } },
    invoicePayments: { list: vi.fn().mockResolvedValue({ data: [] }) }, invoices: { retrieve: vi.fn().mockResolvedValue(invoice) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) } };
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: known ? { id: payment.metadata.product_id } : null, error: null }) };
  return { stripe: stripe as unknown as Stripe, db: { from: () => q } as unknown as ReturnType<typeof createAdminClient>, retrieve };
}
describe('pending Stripe payment classification', () => {
  it('asks Stripe to redeliver an event bound to a local product', async () => {
    const c = clients();expect(await pendingPaymentResult(c.db,c.stripe,payment.id)).toMatchObject({ processed: false });
  });
  it('acknowledges another installations product', async () => {
    const c = clients(false);expect(await pendingPaymentResult(c.db,c.stripe,payment.id)).toMatchObject({ processed: true });
  });
  it('uses the owning checkout when payment metadata is absent', async () => {
    const pi = structuredClone(payment) as Partial<typeof payment>;delete pi.metadata;
    const c = clients(true,pi);vi.mocked(c.stripe.checkout.sessions.list).mockResolvedValue({ data: [session.data.object] } as never);
    expect(await pendingPaymentResult(c.db,c.stripe,payment.id)).toMatchObject({ processed: false });
  });
  it('resolves a recurring invoice and subscription when optional metadata is absent', async () => {
    const pi = structuredClone(payment) as Partial<typeof payment>;delete pi.metadata;
    const c = clients(true,pi);
    const payments = invoice.payments.data;
    vi.mocked(c.stripe.invoicePayments.list).mockResolvedValue({ data: payments } as never);
    expect(await pendingPaymentResult(c.db,c.stripe,payment.id)).toMatchObject({ processed: false });
  });
  it('acknowledges an unbound payment without any local product or subscription', async () => {
    const pi = structuredClone(payment) as Partial<typeof payment>;delete pi.metadata;
    const c = clients(false,pi);expect(await pendingPaymentResult(c.db,c.stripe,payment.id)).toMatchObject({ processed: true });
  });
  it('keeps provider and database failures retriable', async () => {
    const c = clients();c.retrieve.mockRejectedValue(new Error('temporarily unavailable'));
    await expect(pendingPaymentResult(c.db,c.stripe,payment.id)).rejects.toThrow('temporarily unavailable');
  });
});
