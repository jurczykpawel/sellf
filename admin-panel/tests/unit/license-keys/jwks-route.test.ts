import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { GET } from '@/app/api/licenses/jwks/route';

const SELLER = '33333333-3333-4333-8333-333333333333';

function adminWith(rows: unknown) {
  return { rpc: vi.fn().mockResolvedValue({ data: rows, error: null }) };
}

function req(query: string) {
  return new NextRequest(`http://localhost:3000/api/licenses/jwks?${query}`);
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createAdminClient).mockReturnValue(
    adminWith([{ kid: 'k1', public_key: '-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----\n', alg: 'ES256' }]) as never,
  );
});

describe('GET /api/licenses/jwks', () => {
  it('returns public keys for a valid seller', async () => {
    const res = await GET(req(`seller=${SELLER}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toEqual([{ kid: 'k1', alg: 'ES256', pem: expect.stringContaining('BEGIN PUBLIC KEY') }]);
    expect(res.headers.get('cache-control') ?? '').toMatch(/public/);
  });

  it('never exposes private-key material', async () => {
    const res = await GET(req(`seller=${SELLER}`));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/encrypted_key|encryption_iv|encryption_tag|PRIVATE KEY/i);
  });

  it('400s when seller is missing or not a uuid', async () => {
    expect((await GET(req('seller=not-a-uuid'))).status).toBe(400);
    expect((await GET(req(''))).status).toBe(400);
  });

  it('429s when rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect((await GET(req(`seller=${SELLER}`))).status).toBe(429);
  });

  it('calls the public-keys RPC, never selects the table directly', async () => {
    const admin = adminWith([]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await GET(req(`seller=${SELLER}`));
    expect(admin.rpc).toHaveBeenCalledWith('seller_license_public_keys', { seller: SELLER });
  });
});
