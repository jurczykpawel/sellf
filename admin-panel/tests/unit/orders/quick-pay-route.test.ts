/** Pay-link endpoint: the signed link is the credential, the server re-quotes and refuses a changed amount. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const quote = vi.hoisted(() => vi.fn()); const create = vi.hoisted(() => vi.fn()); const limit = vi.hoisted(() => vi.fn());
const single = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/quick-pay', () => ({ quoteOrderPayment: quote, createQuickPaySession: create }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: limit }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq']) q[m] = () => q; q.single = single; return q; } }) }));
import { POST } from '@/app/api/orders/[orderId]/pay/route';
import { signTransferToken } from '@/lib/orders/transfer-token';
const id = '10000000-0000-4000-8000-000000000001';
const call = (body: unknown, orderId = id) => POST(new NextRequest(`http://localhost/api/orders/${orderId}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ orderId }) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('CHECKOUT_BINDING_SECRET', 'test-binding-secret'); vi.stubEnv('SITE_URL', 'https://shop.example');
  limit.mockResolvedValue(true); single.mockResolvedValue({ data: { id, payment_provider: 'bank_transfer', status: 'awaiting_payment', amount: 8000, currency: 'PLN', metadata: { locale: 'pl' }, products: { name: 'Warsztat', slug: 'w' } }, error: null });
  quote.mockResolvedValue({ mode: 'settle', amount: 8000, currency: 'PLN' }); create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_quick' });
});
describe('pay link endpoint', () => {
  it('rejects a forged link without quoting', async () => {
    expect((await call({ token: '1.bad', expectedAmount: 8000 })).status).toBe(404);
    expect(quote).not.toHaveBeenCalled();
  });
  it('returns the Stripe Checkout URL for the confirmed amount', async () => {
    const response = await call({ token: signTransferToken(id), expectedAmount: 8000 });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_quick' });
    expect(create.mock.calls[0][4]).toMatchObject({ returnUrl: expect.stringMatching(`^https://shop.example/pl/order/${id}/transfer\\?token=`) });
  });
  it('a changed amount is refused with the new quote so the buyer confirms it', async () => {
    const response = await call({ token: signTransferToken(id), expectedAmount: 5000 });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ quote: { mode: 'settle', amount: 8000 } });
    expect(create).not.toHaveBeenCalled();
  });
  it('an order that cannot be revived points to a new checkout at today\'s price', async () => {
    quote.mockResolvedValue({ mode: 'unavailable', reason: 'price_changed' });
    const response = await call({ token: signTransferToken(id), expectedAmount: 8000 });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ reason: 'price_changed', checkoutUrl: 'https://shop.example/pl/checkout/w' });
  });
  it('is rate limited', async () => {
    limit.mockResolvedValue(false);
    expect((await call({ token: signTransferToken(id), expectedAmount: 8000 })).status).toBe(429);
  });
});
