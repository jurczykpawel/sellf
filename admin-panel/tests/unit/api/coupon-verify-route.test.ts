import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rateLimiting = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  checkRateLimitForIdentifier: vi.fn(),
  getRateLimitIdentifier: vi.fn(),
}));
vi.mock('@/lib/rate-limiting', () => rateLimiting);

const userClient = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => userClient }));

const serviceClient = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => serviceClient }));

import { POST } from '@/app/api/coupons/verify/route';

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/coupons/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiting.checkRateLimit.mockResolvedValue(true);
  rateLimiting.checkRateLimitForIdentifier.mockResolvedValue(true);
  rateLimiting.getRateLimitIdentifier.mockResolvedValue('ip:203.0.113.7');
  const productQuery = {
    select: () => productQuery,
    eq: () => productQuery,
    single: async () => ({ data: { currency: 'PLN' }, error: null }),
  };
  userClient.from.mockReturnValue(productQuery);
  serviceClient.rpc.mockResolvedValue({ data: { valid: false, error: 'Invalid code' }, error: null });
});

describe('POST /api/coupons/verify', () => {
  it('counts attempts on a code per client, not across all clients', async () => {
    await POST(request({ code: 'spring', productId: PRODUCT_ID }));

    expect(rateLimiting.checkRateLimitForIdentifier).toHaveBeenCalledWith(
      'coupon_verify_code',
      5,
      60,
      'code:SPRING:ip:203.0.113.7',
    );
  });

  it('verifies the coupon with the server client after its own limits passed', async () => {
    await POST(request({ code: 'spring', productId: PRODUCT_ID, email: 'buyer@example.com' }));

    expect(serviceClient.rpc).toHaveBeenCalledWith('verify_coupon', {
      code_param: 'SPRING',
      product_id_param: PRODUCT_ID,
      customer_email_param: 'buyer@example.com',
      currency_param: 'PLN',
    });
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it('returns 429 without calling the database function when the client is over its limit', async () => {
    rateLimiting.checkRateLimit.mockResolvedValue(false);
    const res = await POST(request({ code: 'spring', productId: PRODUCT_ID }));
    expect(res.status).toBe(429);
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });
});
