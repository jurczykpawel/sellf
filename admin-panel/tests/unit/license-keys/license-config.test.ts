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
  storeSellerKey: vi.fn(),
  loadActivePublicKeyInfo: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  generateSellerKeypair,
  importSellerKey,
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

/** A products-table chain mock for setProductLicenseConfig: update().eq().eq(). */
function productsUpdateChain(error: unknown = null) {
  const eq = vi.fn();
  const builder = { eq };
  eq.mockImplementation(() => builder); // chainable; awaiting resolves below
  // Make the builder thenable so `await update().eq().eq()` resolves to {error}.
  (builder as unknown as { then: unknown }).then = (resolve: (v: { error: unknown }) => void) =>
    resolve({ error });
  const update = vi.fn(() => builder);
  return { update, eq };
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
    adminFromMock.mockReturnValue(productsUpdateChain({ message: 'boom' }));
    const res = await setProductLicenseConfig('prod-1', { enabled: false, tier: null, durationDays: null });
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
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

  it('rejects an invalid PEM with an error result and does not throw', async () => {
    const deact = deactivateChain();
    adminFromMock.mockReturnValue(deact);
    vi.mocked(importSellerKey).mockRejectedValue(new Error('bad pem'));

    const res = await uploadSellerLicenseKey('not-a-key');
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('rejects empty input before touching the DB', async () => {
    const res = await uploadSellerLicenseKey('   ');
    expect(res.success).toBe(false);
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
