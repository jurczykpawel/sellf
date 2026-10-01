import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rateLimiting = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => rateLimiting);

const userClient = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => userClient }));

const serviceClient = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => serviceClient }));

import { GET } from '@/app/api/oto/info/route';

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiting.checkRateLimit.mockResolvedValue(true);
  serviceClient.rpc.mockResolvedValue({ data: { valid: false }, error: null });
});

describe('GET /api/oto/info', () => {
  it('looks the offer up server-side after the per-client limit', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/oto/info?code=OTO1&email=Buyer@Example.com'));

    expect(res.status).toBe(200);
    expect(serviceClient.rpc).toHaveBeenCalledWith('get_oto_coupon_info', {
      coupon_code_param: 'OTO1',
      email_param: 'buyer@example.com',
    });
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it('returns 429 without a lookup when the client is over its limit', async () => {
    rateLimiting.checkRateLimit.mockResolvedValue(false);
    const res = await GET(new NextRequest('http://localhost:3000/api/oto/info?code=OTO1&email=b@example.com'));
    expect(res.status).toBe(429);
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });
});
