import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/license-keys/keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/license-keys/keys')>('@/lib/license-keys/keys');
  return { ...actual, loadActiveSellerKey: vi.fn() };
});

import { loadActiveSellerKey, generateSellerKeypair } from '@/lib/license-keys/keys';
import { verifyLicense } from '@/lib/license-keys/format';
import { issueLicense } from '@/lib/license-keys/issue';

const SELLER = '33333333-3333-3333-3333-333333333333';
const PRODUCT = '11111111-1111-1111-1111-111111111111';
const NOW = new Date(1_000_000 * 1000);
const key = generateSellerKeypair();

interface ProductCfg { issue_license_on_purchase: boolean; license_tier: string | null; license_duration_days: number | null }

function adminMock(opts: { product?: ProductCfg | null; existing?: { license_key: string } | null; insert?: ReturnType<typeof vi.fn> }) {
  const insert = opts.insert ?? vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === 'products') {
      const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: opts.product ?? null, error: null }) };
      return c;
    }
    // issued_licenses
    const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: opts.existing ?? null, error: null }), insert };
    return c;
  });
  return { from };
}

const call = (admin: unknown) =>
  issueLicense(admin as never, { sellerId: SELLER, productId: PRODUCT, productSlug: 'pro-kit', email: 'a@b.co', userId: null, orderId: 'ord_1' }, { now: NOW });

beforeEach(() => {
  vi.mocked(loadActiveSellerKey).mockReset();
  vi.mocked(loadActiveSellerKey).mockResolvedValue({ kid: key.kid, publicKeyPem: key.publicKeyPem, privateKeyPem: key.privateKeyPem });
});

describe('issueLicense', () => {
  it('returns null when the product does not have issuance enabled', async () => {
    const admin = adminMock({ product: { issue_license_on_purchase: false, license_tier: null, license_duration_days: null } });
    expect(await call(admin)).toBeNull();
    expect(vi.mocked(loadActiveSellerKey)).not.toHaveBeenCalled();
  });

  it('returns null when the seller has no active key', async () => {
    vi.mocked(loadActiveSellerKey).mockResolvedValue(null);
    const admin = adminMock({ product: { issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: null } });
    expect(await call(admin)).toBeNull();
  });

  it('issues a perpetual license whose claims match and verify under the seller key', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = adminMock({ product: { issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: null }, insert });
    const token = await call(admin);
    expect(token).toBeTruthy();
    const r = verifyLicense(token as string, key.publicKeyPem, { now: NOW });
    expect(r).toMatchObject({ valid: true, claims: { product: 'pro-kit', email: 'a@b.co', order: 'ord_1', tier: 'pro', exp: null, kid: key.kid } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'ord_1', product_id: PRODUCT, kid: key.kid, license_key: token, expires_at: null }));
  });

  it('sets exp from license_duration_days', async () => {
    const admin = adminMock({ product: { issue_license_on_purchase: true, license_tier: null, license_duration_days: 30 } });
    const token = await call(admin);
    const claims = verifyLicense(token as string, key.publicKeyPem, { now: NOW });
    if (!claims.valid) throw new Error('expected valid');
    expect(claims.claims.exp).toBe(Math.floor(NOW.getTime() / 1000) + 30 * 86400);
  });

  it('is idempotent — returns the already-issued license without re-inserting', async () => {
    const insert = vi.fn();
    const admin = adminMock({ product: { issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: null }, existing: { license_key: 'EXISTING.TOKEN' }, insert });
    expect(await call(admin)).toBe('EXISTING.TOKEN');
    expect(insert).not.toHaveBeenCalled();
  });
});
