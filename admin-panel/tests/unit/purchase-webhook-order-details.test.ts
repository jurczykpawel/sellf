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
  it('keeps the serialized legacy payload identical to the recorded pre-change body', async () => {
    const { params, from } = setup(false);
    const serialized = JSON.stringify(await buildPurchaseWebhookPayload(params));
    expect(serialized).toBe(readFileSync('tests/unit/fixtures/purchase-legacy-body.json', 'utf8'));
    expect(from).not.toHaveBeenCalledWith('payment_transactions');
  });
  it('includes all five stable module keys and uses the stored invoice and recipient', async () => {
    const { params } = setup(true);
    const payload = await buildPurchaseWebhookPayload(params);
    expect(payload).toHaveProperty('orderDetails', details);
    expect(payload.invoice).toEqual({ needsInvoice: true, nip: details.buyer.nip, companyName: details.buyer.company_name, address: details.buyer.address, city: details.buyer.city, postalCode: details.buyer.postal_code, country: 'PL', recipient: details.recipient });
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
});
