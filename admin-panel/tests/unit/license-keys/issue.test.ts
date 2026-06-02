import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/license-keys/keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/license-keys/keys')>('@/lib/license-keys/keys');
  return { ...actual, loadActiveSellerKey: vi.fn() };
});

import { loadActiveSellerKey, generateSellerKeypair } from '@/lib/license-keys/keys';
import { verifyLicense } from '@/lib/license-keys/format';
import { issueLicense } from '@/lib/license-keys/issue';

const SELLER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date(1_000_000 * 1000);
const key = generateSellerKeypair();

interface ProductRow {
  seller_id: string;
  slug: string;
  issue_license_on_purchase: boolean;
  license_tier: string | null;
  license_duration_days: number | null;
}

function adminMock(opts: { product?: ProductRow | null; existing?: { license_key: string; kid: string; seller_id: string } | null; insert?: ReturnType<typeof vi.fn> }) {
  const insert = opts.insert ?? vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === 'products') {
      const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: opts.product ?? null, error: null }) };
      return c;
    }
    const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: opts.existing ?? null, error: null }), insert };
    return c;
  });
  return { from };
}

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  seller_id: SELLER, slug: 'pro-kit', issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: null, ...over,
});

const call = (admin: unknown) =>
  issueLicense(admin as never, { productId: PRODUCT, email: 'a@b.co', userId: null, orderId: 'ord_1' }, { now: NOW });

beforeEach(() => {
  vi.mocked(loadActiveSellerKey).mockReset();
  vi.mocked(loadActiveSellerKey).mockResolvedValue({ kid: key.kid, publicKeyPem: key.publicKeyPem, privateKeyPem: key.privateKeyPem });
});

describe('issueLicense', () => {
  it('returns null when the product does not have issuance enabled', async () => {
    expect(await call(adminMock({ product: product({ issue_license_on_purchase: false }) }))).toBeNull();
    expect(vi.mocked(loadActiveSellerKey)).not.toHaveBeenCalled();
  });

  it('returns null when the product is unknown', async () => {
    expect(await call(adminMock({ product: null }))).toBeNull();
  });

  it('returns null when the seller has no active key', async () => {
    vi.mocked(loadActiveSellerKey).mockResolvedValue(null);
    expect(await call(adminMock({ product: product() }))).toBeNull();
  });

  it('issues a perpetual license whose claims verify under the seller key', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const result = await call(adminMock({ product: product(), insert }));
    expect(result).toBeTruthy();
    const r = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    expect(r).toMatchObject({ valid: true, claims: { product: 'pro-kit', email: 'a@b.co', order: 'ord_1', tier: 'pro', exp: null, kid: key.kid } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ seller_id: SELLER, order_id: 'ord_1', product_id: PRODUCT, kid: key.kid, license_key: result!.token, expires_at: null }));
    expect(result).toMatchObject({ kid: key.kid, sellerId: SELLER });
  });

  it('loads the seller key for the product owner', async () => {
    await call(adminMock({ product: product() }));
    expect(vi.mocked(loadActiveSellerKey)).toHaveBeenCalledWith(expect.anything(), SELLER);
  });

  it('sets exp from license_duration_days', async () => {
    const result = await call(adminMock({ product: product({ license_duration_days: 30 }) }));
    const r = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    if (!r.valid) throw new Error('expected valid');
    expect(r.claims.exp).toBe(Math.floor(NOW.getTime() / 1000) + 30 * 86400);
  });

  it('is idempotent — returns the already-issued result without re-inserting', async () => {
    const insert = vi.fn();
    const existing = { license_key: 'EXISTING.TOKEN', kid: 'existingkid', seller_id: SELLER };
    const result = await call(adminMock({ product: product(), existing, insert }));
    expect(result).toEqual({ token: 'EXISTING.TOKEN', kid: 'existingkid', sellerId: SELLER });
    expect(insert).not.toHaveBeenCalled();
  });
});
