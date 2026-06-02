import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock auth wrapper: passes through with a fixed authenticated user ---
const SELLER = '44444444-4444-4444-4444-444444444444';
vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminAuth: vi.fn(async (fn) => fn({ user: { id: SELLER }, supabase: {} })),
}));

// --- Mock admin client factory ---
const adminFromMock = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFromMock })),
}));

// --- Mock keys module (crypto/db core — do not exercise real crypto) ---
vi.mock('@/lib/license-keys/keys', () => ({
  generateSellerKeypair: vi.fn(),
  importSellerKey: vi.fn(),
  publicFromPrivate: vi.fn(),
  storeSellerKey: vi.fn(),
  loadActivePublicKeyInfo: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  generateSellerKeypair,
  importSellerKey,
  publicFromPrivate,
  storeSellerKey,
  loadActivePublicKeyInfo,
} from '@/lib/license-keys/keys';
import {
  setProductLicenseConfig,
  generateSellerLicenseKey,
  uploadSellerLicenseKey,
  getSellerLicenseInfo,
} from '@/lib/actions/license-config';

const KEYPAIR = {
  publicKeyPem: '-----BEGIN PUBLIC KEY-----\nPUB\n-----END PUBLIC KEY-----\n',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nPRIV\n-----END PRIVATE KEY-----\n',
  kid: 'abcdef0123456789',
};

/** A products-table chain mock for setProductLicenseConfig: update().eq().eq().select('id'). */
function productsUpdateChain(opts: { error?: unknown; rows?: Array<{ id: string }> } = {}) {
  const error = opts.error ?? null;
  const rows = opts.rows ?? [{ id: 'prod-1' }];
  const select = vi.fn(() => Promise.resolve({ data: error ? null : rows, error }));
  const eq = vi.fn();
  const builder = { eq, select };
  eq.mockImplementation(() => builder); // chainable; .select('id') terminates
  const update = vi.fn(() => builder);
  return { update, eq, select };
}

/** A deactivation chain: update().eq().eq() resolving to {error}. */
function deactivateChain(error: unknown = null) {
  const inner = { eq: vi.fn().mockResolvedValue({ error }) };
  const eq1 = vi.fn(() => inner);
  const update = vi.fn(() => ({ eq: eq1 }));
  return { update };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SITE_URL = 'https://shop.example.com';
});

describe('setProductLicenseConfig', () => {
  it('updates the three product columns and scopes by seller_id', async () => {
    const chain = productsUpdateChain();
    adminFromMock.mockReturnValue(chain);

    const res = await setProductLicenseConfig('prod-1', { enabled: true, tier: 'pro', durationDays: 365 });

    expect(res.success).toBe(true);
    expect(adminFromMock).toHaveBeenCalledWith('products');
    expect(chain.update).toHaveBeenCalledWith({
      issue_license_on_purchase: true,
      license_tier: 'pro',
      license_duration_days: 365,
    });
    expect(chain.eq).toHaveBeenCalledWith('seller_id', SELLER);
  });

  it('normalises empty tier and empty duration to null (perpetual)', async () => {
    const chain = productsUpdateChain();
    adminFromMock.mockReturnValue(chain);

    await setProductLicenseConfig('prod-1', { enabled: true, tier: '', durationDays: null });

    expect(chain.update).toHaveBeenCalledWith({
      issue_license_on_purchase: true,
      license_tier: null,
      license_duration_days: null,
    });
  });

  it('returns an error result when the DB update fails', async () => {
    adminFromMock.mockReturnValue(productsUpdateChain({ error: { message: 'boom' } }));
    const res = await setProductLicenseConfig('prod-1', { enabled: false, tier: null, durationDays: null });
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('returns NOT_FOUND when no row matches (product missing or not owned)', async () => {
    adminFromMock.mockReturnValue(productsUpdateChain({ rows: [] }));
    const res = await setProductLicenseConfig('prod-1', { enabled: true, tier: 'pro', durationDays: null });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('rejects an over-long tier before touching the DB', async () => {
    const res = await setProductLicenseConfig('prod-1', { enabled: true, tier: 'x'.repeat(81), durationDays: null });
    expect(res).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
    expect(adminFromMock).not.toHaveBeenCalled();
  });

  it('rejects a non-positive / non-integer duration', async () => {
    expect((await setProductLicenseConfig('prod-1', { enabled: true, tier: null, durationDays: 0 })).errorCode).toBe('INVALID_INPUT');
    expect((await setProductLicenseConfig('prod-1', { enabled: true, tier: null, durationDays: -5 })).errorCode).toBe('INVALID_INPUT');
    expect((await setProductLicenseConfig('prod-1', { enabled: true, tier: null, durationDays: 1.5 })).errorCode).toBe('INVALID_INPUT');
  });
});

describe('generateSellerLicenseKey', () => {
  it('generates, deactivates prior keys, stores managed, returns kid + publicKey (never private)', async () => {
    vi.mocked(generateSellerKeypair).mockReturnValue(KEYPAIR);
    const deact = deactivateChain();
    adminFromMock.mockReturnValue(deact);
    vi.mocked(storeSellerKey).mockResolvedValue({ kid: KEYPAIR.kid });

    const res = await generateSellerLicenseKey();

    expect(res.success).toBe(true);
    expect(adminFromMock).toHaveBeenCalledWith('seller_license_keys');
    expect(deact.update).toHaveBeenCalledWith({ is_active: false });
    expect(vi.mocked(storeSellerKey)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sellerId: SELLER, custody: 'managed', publicKeyPem: KEYPAIR.publicKeyPem }),
    );
    expect(res.data).toEqual({ kid: KEYPAIR.kid, publicKeyPem: KEYPAIR.publicKeyPem });
    expect(JSON.stringify(res)).not.toContain('PRIVATE');
  });
});

describe('uploadSellerLicenseKey', () => {
  it('imports a BYOK key, deactivates prior, returns kid (never private)', async () => {
    const deact = deactivateChain();
    adminFromMock.mockReturnValue(deact);
    vi.mocked(importSellerKey).mockResolvedValue({ kid: KEYPAIR.kid });

    const res = await uploadSellerLicenseKey(KEYPAIR.privateKeyPem);

    expect(res.success).toBe(true);
    expect(deact.update).toHaveBeenCalledWith({ is_active: false });
    expect(vi.mocked(importSellerKey)).toHaveBeenCalledWith(
      expect.anything(),
      { sellerId: SELLER, privateKeyPem: KEYPAIR.privateKeyPem.trim() },
    );
    expect(res.data).toEqual({ kid: KEYPAIR.kid });
  });

  it('rejects an invalid PEM before deactivating prior keys (early validation)', async () => {
    vi.mocked(publicFromPrivate).mockImplementation(() => { throw new Error('bad pem'); });
    const res = await uploadSellerLicenseKey('not-a-key');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('INVALID_KEY');
    expect(adminFromMock).not.toHaveBeenCalled();
    expect(vi.mocked(importSellerKey)).not.toHaveBeenCalled();
  });

  it('returns STORE_FAILED when the key is valid but DB insert fails', async () => {
    vi.mocked(publicFromPrivate).mockReturnValue('-----BEGIN PUBLIC KEY-----\nPUB\n-----END PUBLIC KEY-----\n');
    const deact = deactivateChain();
    adminFromMock.mockReturnValue(deact);
    vi.mocked(importSellerKey).mockRejectedValue(new Error('db error'));

    const res = await uploadSellerLicenseKey(KEYPAIR.privateKeyPem);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('STORE_FAILED');
  });

  it('rejects empty input before touching the DB', async () => {
    const res = await uploadSellerLicenseKey('   ');
    expect(res.success).toBe(false);
    expect(vi.mocked(importSellerKey)).not.toHaveBeenCalled();
  });

  it('rejects an oversized PEM before parsing', async () => {
    const res = await uploadSellerLicenseKey('-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(9000) + '\n-----END PRIVATE KEY-----');
    expect(res).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
    expect(vi.mocked(importSellerKey)).not.toHaveBeenCalled();
  });
});

describe('getSellerLicenseInfo', () => {
  it('returns kid, publicKey and a seller-scoped jwksUrl', async () => {
    vi.mocked(loadActivePublicKeyInfo).mockResolvedValue({
      kid: KEYPAIR.kid,
      publicKeyPem: KEYPAIR.publicKeyPem,
      privateKeyPem: KEYPAIR.privateKeyPem,
    });

    const res = await getSellerLicenseInfo();

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      kid: KEYPAIR.kid,
      publicKeyPem: KEYPAIR.publicKeyPem,
      jwksUrl: `https://shop.example.com/api/licenses/jwks?seller=${SELLER}`,
    });
    expect(JSON.stringify(res)).not.toContain('PRIVATE');
  });

  it('returns null data when the seller has no active key', async () => {
    vi.mocked(loadActivePublicKeyInfo).mockResolvedValue(null);
    const res = await getSellerLicenseInfo();
    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
  });
});
