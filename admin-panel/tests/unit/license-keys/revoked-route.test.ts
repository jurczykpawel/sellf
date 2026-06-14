import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));

import { GET } from '@/app/api/licenses/revoked/route';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const SELLER = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);

function req(query: string) {
  return new NextRequest(`http://localhost:3000/api/licenses/revoked?${query}`);
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createAdminClient).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({ data: [{ order_hash: HASH }], error: null }),
  } as never);
});

describe('GET /api/licenses/revoked', () => {
  it('returns only SHA-256 order hashes', async () => {
    const response = await GET(req(`seller=${SELLER}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ order_hashes: [HASH] });
  });

  it('never exposes raw order ids returned by a malformed RPC response', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ order_hash: HASH, order_id: 'pi_sensitive' }],
        error: null,
      }),
    } as never);
    const response = await GET(req(`seller=${SELLER}`));
    expect(JSON.stringify(await response.json())).not.toContain('pi_sensitive');
  });

  it('fails closed when the RPC returns a malformed hash', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: [{ order_hash: 'not-a-hash' }], error: null }),
    } as never);
    expect((await GET(req(`seller=${SELLER}`))).status).toBe(500);
  });

  it('uses the scoped RPC and validates/rate-limits requests', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await GET(req(`seller=${SELLER}`));
    expect(admin.rpc).toHaveBeenCalledWith('seller_revoked_orders', { seller: SELLER });

    expect((await GET(req('seller=invalid'))).status).toBe(400);
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect((await GET(req(`seller=${SELLER}`))).status).toBe(429);
  });
});
