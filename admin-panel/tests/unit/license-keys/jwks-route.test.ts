import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { GET } from '@/app/api/licenses/jwks/route';

const SELLER = '33333333-3333-4333-8333-333333333333';

function ecPem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'P-256', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).publicKey;
}
const PEM_ACTIVE = ecPem();
const PEM_RETIRED = ecPem();

function jwkOf(pem: string) {
  const { x, y } = createPublicKey(pem).export({ format: 'jwk' });
  return { kty: 'EC', crv: 'P-256', x, y };
}

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
    adminWith([{ kid: 'k1', public_key: PEM_ACTIVE, alg: 'ES256', status: 'active' }]) as never,
  );
});

describe('GET /api/licenses/jwks', () => {
  it('returns public keys for a valid seller', async () => {
    const res = await GET(req(`seller=${SELLER}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toEqual([{ ...jwkOf(PEM_ACTIVE), kid: 'k1', alg: 'ES256', use: 'sig', pem: PEM_ACTIVE, status: 'active' }]);
    expect(res.headers.get('cache-control') ?? '').toMatch(/public/);
  });

  it('publishes retired keys after the active one, so licenses signed before a key change keep verifying', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminWith([
      { kid: 'new', public_key: PEM_ACTIVE, alg: 'ES256', status: 'active' },
      { kid: 'old', public_key: PEM_RETIRED, alg: 'ES256', status: 'retired' },
    ]) as never);
    const body = await (await GET(req(`seller=${SELLER}`))).json();
    expect(body.keys).toEqual([
      { ...jwkOf(PEM_ACTIVE), kid: 'new', alg: 'ES256', use: 'sig', pem: PEM_ACTIVE, status: 'active' },
      { ...jwkOf(PEM_RETIRED), kid: 'old', alg: 'ES256', use: 'sig', pem: PEM_RETIRED, status: 'retired' },
    ]);
  });

  it('every published key imports as a JWK in Node and matches its PEM', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminWith([
      { kid: 'new', public_key: PEM_ACTIVE, alg: 'ES256', status: 'active' },
      { kid: 'old', public_key: PEM_RETIRED, alg: 'ES256', status: 'retired' },
    ]) as never);
    const body = await (await GET(req(`seller=${SELLER}`))).json();
    for (const key of body.keys) {
      const imported = createPublicKey({ key, format: 'jwk' });
      expect(imported.export({ type: 'spki', format: 'pem' }).toString()).toBe(key.pem);
    }
  });

  it('leaves out a stored key that is not EC P-256 instead of failing the whole response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createAdminClient).mockReturnValue(adminWith([
      { kid: 'good', public_key: PEM_ACTIVE, alg: 'ES256', status: 'active' },
      { kid: 'bad', public_key: 'not a key', alg: 'ES256', status: 'retired' },
    ]) as never);
    const res = await GET(req(`seller=${SELLER}`));
    expect(res.status).toBe(200);
    expect((await res.json()).keys.map((k: { kid: string }) => k.kid)).toEqual(['good']);
    errorSpy.mockRestore();
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
