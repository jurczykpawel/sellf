import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rateLimiting = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => rateLimiting);

const userClient = vi.hoisted(() => ({ auth: { getUser: vi.fn() }, rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => userClient }));

const serviceClient = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => serviceClient }));

import { POST } from '@/app/api/coupons/auto-apply/route';

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/coupons/auto-apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiting.checkRateLimit.mockResolvedValue(true);
  userClient.rpc.mockResolvedValue({ data: { found: false }, error: null });
  serviceClient.rpc.mockResolvedValue({ data: { found: false }, error: null });
});

describe('POST /api/coupons/auto-apply', () => {
  it('looks up a guest by the typed e-mail on the server client', async () => {
    userClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(request({ email: 'guest@example.com', productId: PRODUCT_ID }));

    expect(res.status).toBe(200);
    expect(serviceClient.rpc).toHaveBeenCalledWith('find_auto_apply_coupon', {
      customer_email_param: 'guest@example.com',
      product_id_param: PRODUCT_ID,
    });
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it('looks up a signed-in user with their own session', async () => {
    userClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'buyer@example.com' } },
      error: null,
    });

    await POST(request({ email: 'someone@example.com', productId: PRODUCT_ID }));

    expect(userClient.rpc).toHaveBeenCalledWith('find_auto_apply_coupon', {
      customer_email_param: 'buyer@example.com',
      product_id_param: PRODUCT_ID,
    });
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });

  it('returns 429 before any lookup when the client is over its limit', async () => {
    rateLimiting.checkRateLimit.mockResolvedValue(false);
    const res = await POST(request({ email: 'guest@example.com', productId: PRODUCT_ID }));
    expect(res.status).toBe(429);
    expect(serviceClient.rpc).not.toHaveBeenCalled();
    expect(userClient.rpc).not.toHaveBeenCalled();
  });
});
