/** @see src/app/api/create-payment-intent/route.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signCheckoutBinding } from '@/lib/security/checkout-binding';

const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), stripe: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.server }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: mocks.stripe }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.limit }));
import { POST } from '@/app/api/create-payment-intent/route';

const productId = '11111111-1111-4111-8111-111111111111';
const clientSecret = 'cs_test_first_secret_value';
const secret = process.env.CHECKOUT_BINDING_SECRET;
function request(bindingToken: string) {
  return new NextRequest('http://localhost/api/create-payment-intent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, clientSecret, bindingToken, expireOnly: true }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
  mocks.limit.mockResolvedValue(true);
});

describe('checkout expire-only request', () => {
  it('expires a bound session without creating another session or reading the product', async () => {
    process.env.CHECKOUT_BINDING_SECRET = 'checkout-expiration-route-test-secret';
    try {
      const query = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: object) => void) => resolve({ error: null }) };
      const update = vi.fn(() => query);
      const from = vi.fn(() => ({ update }));
      mocks.admin.mockReturnValue({ from });
      const sessions = {
        retrieve: vi.fn(async () => ({ status: 'open', metadata: { product_id: productId } })),
        expire: vi.fn(async () => ({ status: 'expired' })), create: vi.fn(),
      };
      mocks.stripe.mockResolvedValue({ checkout: { sessions } });
      const token = signCheckoutBinding({ stripeObjectId: 'cs_test_first', userId: null, productId });
      const response = await POST(request(token));
      expect(response.status).toBe(200);
      expect(sessions.expire).toHaveBeenCalledWith('cs_test_first');
      expect(sessions.create).not.toHaveBeenCalled();
      expect(from).toHaveBeenCalledExactlyOnceWith('payment_transactions');
      expect(query.eq).toHaveBeenCalledWith('status', 'pending');
    } finally {
      if (secret === undefined) delete process.env.CHECKOUT_BINDING_SECRET;
      else process.env.CHECKOUT_BINDING_SECRET = secret;
    }
  });
  it('returns an invalid-binding response without modifying sessions or rows', async () => {
    const sessions = { retrieve: vi.fn(async () => ({ status: 'open', metadata: { product_id: productId } })), expire: vi.fn(), create: vi.fn() };
    const from = vi.fn();
    mocks.admin.mockReturnValue({ from });
    mocks.stripe.mockResolvedValue({ checkout: { sessions } });
    const response = await POST(request('invalid'));
    expect(response.status).toBe(403);
    expect(sessions.expire).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
