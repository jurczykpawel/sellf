import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import type { BuildWebhookPayloadParams } from '@/lib/services/webhook-payload';

import details from './fixtures/order-details.json';
const product = { id: 'prod_1', name: 'Workshop', slug: 'workshop', price: 149, currency: 'PLN', icon: null };
function setup(profile: boolean, stored: unknown = details, sessionId: string | undefined = 'cs_test') {
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { ...product, checkout_profile: profile ? { v: 1, modules: [] } : null } }) }) }) }));
  const params: BuildWebhookPayloadParams = {
    supabaseClient: { from } as unknown as BuildWebhookPayloadParams['supabaseClient'],
    customerEmail: 'office@example.com', userId: null, productId: product.id, bumpProductIds: [],
    metadata: { needs_invoice: 'true', company_name: 'Old metadata', nip: '123', address: 'Old 1', city: 'Old', postal_code: '00-000', country: 'PL', first_name: 'Jan', last_name: 'Kowalski' },
    orderDetails: stored,
    amount: 74500, currency: 'PLN', sessionId, paymentIntentId: 'pi_test', couponId: null, isGuest: true,
  };
  return { params, from };
}
describe('purchase order details', () => {
  it('keeps recorded customer and invoice data with explicit minor-unit prices', async () => {
    const { params, from } = setup(false);
    const recorded = JSON.parse(readFileSync('tests/unit/fixtures/purchase-legacy-body.json', 'utf8'));
    const payload = await buildPurchaseWebhookPayload(params);
    expect(payload.customer).toEqual(recorded.customer); expect(payload.invoice).toEqual({ ...recorded.invoice, taxIdType: 'pl_nip', taxIdCountry: 'PL' });
    expect(payload.order).toMatchObject(recorded.order);
    expect(payload.product).toMatchObject({ ...recorded.product, price: 14900, net: null, tax: null });
    expect(payload.amountUnit).toBe('minor'); expect(payload.order.taxSnapshotStatus).toBe('unavailable');
    expect(from).not.toHaveBeenCalledWith('payment_transactions');
  });
  it('includes all five stable module keys and uses the stored invoice and recipient', async () => {
    const { params } = setup(true);
    const payload = await buildPurchaseWebhookPayload(params);
    expect(payload).toHaveProperty('orderDetails', details);
    expect(payload.invoice).toEqual({ needsInvoice: true, nip: details.buyer.nip, companyName: details.buyer.company_name, address: details.buyer.address, city: details.buyer.city, postalCode: details.buyer.postal_code, country: 'PL', taxIdType: 'pl_nip', taxIdCountry: 'PL', recipient: details.recipient });
  });
  it('uses stored details for orders without a Stripe session and emits explicit absent keys', async () => {
    const { params } = setup(true, { buyer: { v: 1, type: 'person', needs_invoice: false } });
    delete params.sessionId;
    const payload = await buildPurchaseWebhookPayload(params);
    expect(payload).toHaveProperty('orderDetails', { buyer: { v: 1, type: 'person', needs_invoice: false }, recipient: null, phone: null, participants: null, quantity: null });
    expect(payload.invoice).toBeUndefined();
  });
  it('omits invoice recipient when the recipient is the buyer', async () => {
    const { params } = setup(true, { ...details, recipient: { v: 1, differs: false } });
    expect((await buildPurchaseWebhookPayload(params)).invoice).not.toHaveProperty('recipient');
  });
  it.each([
    ['DE', 'DE123456789', 'eu_vat'], ['US', 'EIN 12-3456789', 'other'],
  ])('tells integrators the %s tax id type @J220', async (country, nip, type) => {
    const { params } = setup(true, { buyer: { ...details.buyer, country, nip } });
    expect((await buildPurchaseWebhookPayload(params)).invoice).toMatchObject({ nip, country, taxIdType: type, taxIdCountry: country });
  });
  it('derives the type for embed purchases from the Stripe customer address', async () => {
    const { params } = setup(false);
    params.metadata = {};
    params.stripeCustomerDetails = { name: 'GmbH', address: { country: 'DE', line1: 'Str 1', city: 'Berlin', postal_code: '10115' }, tax_ids: [{ type: 'eu_vat', value: 'DE123456789' }] } as unknown as BuildWebhookPayloadParams['stripeCustomerDetails'];
    expect((await buildPurchaseWebhookPayload(params)).invoice).toMatchObject({ nip: 'DE123456789', taxIdType: 'eu_vat', taxIdCountry: 'DE' });
  });
});
