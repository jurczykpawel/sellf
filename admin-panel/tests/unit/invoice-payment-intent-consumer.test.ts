/** Refund reconciliation must retain an invoice's PaymentIntent even without its optional parent. */
import { expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import recorded from '../fixtures/stripe/invoice_expanded_payments.json';
import { resolveInvoicePaymentIntentId } from '@/app/api/webhooks/stripe/subscription-handlers';

const invoice = recorded as unknown as Stripe.Invoice;
const paidPayment = invoice.payments!.data.find(item => item.status === 'paid' && item.payment.type === 'payment_intent')!;
const intent = paidPayment.payment.payment_intent!;
const expectedId = typeof intent === 'string' ? intent : intent.id;

it('recovers a paid invoice PaymentIntent when both payments and parent are absent from the event', async () => {
  const missing = structuredClone(invoice);
  Reflect.deleteProperty(missing, 'payments'); Reflect.deleteProperty(missing, 'parent');
  const retrieve = vi.fn().mockResolvedValue(invoice);
  expect(await resolveInvoicePaymentIntentId(missing, { invoices: { retrieve } } as unknown as Stripe)).toBe(expectedId);
  expect(retrieve).toHaveBeenCalledWith(invoice.id, { expand: ['payments'] });
});
it('uses already expanded recorded payments without another read', async () => {
  const retrieve = vi.fn();
  expect(await resolveInvoicePaymentIntentId(invoice, { invoices: { retrieve } } as unknown as Stripe)).toBe(expectedId);
  expect(retrieve).not.toHaveBeenCalled();
});
it('does not manufacture a PaymentIntent when a paid invoice has no intent-backed payment', async () => {
  const noPayments = structuredClone(invoice); noPayments.payments!.data = [];
  expect(await resolveInvoicePaymentIntentId(noPayments, {} as Stripe)).toBeNull();
});
