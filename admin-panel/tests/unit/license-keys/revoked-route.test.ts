import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));

import { GET } from '@/app/api/licenses/revoked/route';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const SELLER = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const PREFIX = 'aaaa';

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
  it('returns only SHA-256 order hashes in the prefix bucket', async () => {
    const response = await GET(req(`seller=${SELLER}&prefix=${PREFIX}`));
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
    const response = await GET(req(`seller=${SELLER}&prefix=${PREFIX}`));
    expect(JSON.stringify(await response.json())).not.toContain('pi_sensitive');
  });

  it('fails closed when the RPC returns a malformed hash', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: [{ order_hash: 'not-a-hash' }], error: null }),
    } as never);
    expect((await GET(req(`seller=${SELLER}&prefix=${PREFIX}`))).status).toBe(500);
  });

  it('passes the seller + hex prefix to the scoped RPC', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await GET(req(`seller=${SELLER}&prefix=${PREFIX}`));
    expect(admin.rpc).toHaveBeenCalledWith('seller_revoked_orders', { seller: SELLER, hash_prefix: PREFIX });
  });

  it('requires a valid seller and hex prefix; rate-limits', async () => {
    expect((await GET(req(`seller=invalid&prefix=${PREFIX}`))).status).toBe(400);
    // prefix is mandatory — there is no full-dump mode
    expect((await GET(req(`seller=${SELLER}`))).status).toBe(400);
    // wildcards / non-hex are rejected before reaching the RPC
    expect((await GET(req(`seller=${SELLER}&prefix=%25`))).status).toBe(400);
    expect((await GET(req(`seller=${SELLER}&prefix=ZZZZ`))).status).toBe(400);
    // too short (< 2 hex)
    expect((await GET(req(`seller=${SELLER}&prefix=a`))).status).toBe(400);

    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect((await GET(req(`seller=${SELLER}&prefix=${PREFIX}`))).status).toBe(429);
  });
});
