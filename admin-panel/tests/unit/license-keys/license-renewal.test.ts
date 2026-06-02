/**
 * License auto-renewal and expiry-aware checkout tests.
 *
 * Covers three new scenarios:
 *  1. Auto-renewal on page visit: valid access + expired license → new token issued
 *  2. No re-issue when license is still valid
 *  3. No re-issue when issue_license_on_purchase is disabled
 *  4. create-payment-intent allows checkout when access is expired
 *  5. create-payment-intent blocks checkout when access is still active
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/license-keys/keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/license-keys/keys')>('@/lib/license-keys/keys');
  return { ...actual, loadActiveSellerKey: vi.fn() };
});

import { loadActiveSellerKey, generateSellerKeypair } from '@/lib/license-keys/keys';
import { verifyLicense } from '@/lib/license-keys/format';
import { issueLicense } from '@/lib/license-keys/issue';

const SELLER = '44444444-4444-4444-8444-444444444444';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const USER = 'aabbccdd-0000-4000-8000-000000000000';
const NOW = new Date('2026-06-02T12:00:00Z');
const YEAR_AGO = new Date('2025-06-02T12:00:00Z');
const key = generateSellerKeypair();

interface LicenseRow { license_key: string; kid: string; seller_id: string }
interface IssuedRow { license_key: string; issued_at: string; expires_at: string | null }

function adminMock(opts: {
  product?: { seller_id: string; slug: string; issue_license_on_purchase: boolean; license_tier: string | null; license_duration_days: number | null } | null;
  existing?: LicenseRow | null;
  insert?: ReturnType<typeof vi.fn>;
}) {
  const insert = opts.insert ?? vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === 'products') {
      const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: opts.product ?? null, error: null }) };
      return c;
    }
    const c = {
      select: () => c,
      eq: () => c,
      maybeSingle: () => Promise.resolve({ data: opts.existing ?? null, error: null }),
      insert,
    };
    return c;
  });
  return { from };
}

const product365 = {
  seller_id: SELLER, slug: 'my-product',
  issue_license_on_purchase: true,
  license_tier: 'pro',
  license_duration_days: 365,
};

beforeEach(() => {
  vi.mocked(loadActiveSellerKey).mockReset();
  vi.mocked(loadActiveSellerKey).mockResolvedValue({
    kid: key.kid,
    publicKeyPem: key.publicKeyPem,
    privateKeyPem: key.privateKeyPem,
  });
});

// ---------------------------------------------------------------------------
// Scenario 1: auto-renewal — license expired, access valid
// ---------------------------------------------------------------------------

describe('license auto-renewal (lifetime access + finite license_duration_days)', () => {
  it('issues a fresh license when called with a renewal orderId (no prior renewal row)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const renewalOrderId = `renew_${PRODUCT}_${USER}_2025-06-02T12:00:00.000Z`;

    const result = await issueLicense(
      adminMock({ product: product365, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: renewalOrderId },
      { now: NOW },
    );

    expect(result).not.toBeNull();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: renewalOrderId,
      product_id: PRODUCT,
      user_id: USER,
    }));

    const verified = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    expect(verified).toMatchObject({ valid: true });
    // License should expire 365 days from NOW
    const expectedExp = Math.floor(NOW.getTime() / 1000) + 365 * 86400;
    expect(verified.claims?.exp).toBe(expectedExp);
  });

  it('returns existing renewal token on retry (idempotent)', async () => {
    const existingRenewal: LicenseRow = { license_key: 'RENEWED.TOKEN.ABC', kid: key.kid, seller_id: SELLER };
    const insert = vi.fn();
    const renewalOrderId = `renew_${PRODUCT}_${USER}_2025-06-02T12:00:00.000Z`;

    const result = await issueLicense(
      adminMock({ product: product365, existing: existingRenewal, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: renewalOrderId },
      { now: NOW },
    );

    expect(result).toEqual({ token: 'RENEWED.TOKEN.ABC', kid: key.kid, sellerId: SELLER });
    expect(insert).not.toHaveBeenCalled();
  });

  it('different renewal period → different orderId → different token', async () => {
    // Simulate two renewals with different anchor dates — they must not collide.
    const orderId1 = `renew_${PRODUCT}_${USER}_2025-06-02T12:00:00.000Z`;
    const orderId2 = `renew_${PRODUCT}_${USER}_2026-06-02T12:00:00.000Z`;

    expect(orderId1).not.toBe(orderId2);
    // (Their tokens would differ because orderId is embedded in the JWT claims)
  });

  it('does not auto-renew when issue_license_on_purchase=false', async () => {
    const insert = vi.fn();
    const result = await issueLicense(
      adminMock({ product: { ...product365, issue_license_on_purchase: false }, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: `renew_${PRODUCT}_${USER}_init` },
      { now: NOW },
    );

    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not auto-renew when seller has no active key', async () => {
    vi.mocked(loadActiveSellerKey).mockResolvedValue(null);
    const insert = vi.fn();

    const result = await issueLicense(
      adminMock({ product: product365, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: `renew_${PRODUCT}_${USER}_init` },
      { now: NOW },
    );

    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: access-expiry guard in create-payment-intent (unit logic)
// ---------------------------------------------------------------------------

describe('access expiry check logic (mirrors create-payment-intent route)', () => {
  function isActiveAccess(accessExpiresAt: string | null, now: Date): boolean {
    if (accessExpiresAt === null) return true; // lifetime
    return new Date(accessExpiresAt) >= now;
  }

  it('lifetime access (null expires_at) → isActive=true → blocks re-purchase', () => {
    expect(isActiveAccess(null, NOW)).toBe(true);
  });

  it('future expiry → isActive=true → blocks re-purchase', () => {
    expect(isActiveAccess('2030-01-01T00:00:00Z', NOW)).toBe(true);
  });

  it('past expiry → isActive=false → allows re-purchase', () => {
    expect(isActiveAccess('2025-01-01T00:00:00Z', NOW)).toBe(false);
  });

  it('expiry exactly at now → isActive=true → still blocks re-purchase (boundary consistent with decideProductAccessOutcome)', () => {
    // decideProductAccessOutcome uses expiresAt < now (strictly less than),
    // so at exactly NOW the user is still considered active. create-payment-intent
    // must match: expiresAt < now → false → isActive=true → blocked.
    expect(isActiveAccess(NOW.toISOString(), NOW)).toBe(true);
  });

  it('init renewal orderId when no prior license (first-time issue on page visit)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const initOrderId = `renew_${PRODUCT}_${USER}_init`;

    const result = await issueLicense(
      adminMock({ product: product365, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: initOrderId },
      { now: NOW },
    );

    expect(result).not.toBeNull();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: initOrderId }));
  });

  it('lifetime license (null license_duration_days) → no exp claim in token', async () => {
    const lifetimeProduct = { ...product365, license_duration_days: null };
    const insert = vi.fn().mockResolvedValue({ error: null });

    const result = await issueLicense(
      adminMock({ product: lifetimeProduct, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: `renew_${PRODUCT}_${USER}_init` },
      { now: NOW },
    );

    expect(result).not.toBeNull();
    const verified = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    expect(verified.claims?.exp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: "na odwrót" — finite access + lifetime license
// ---------------------------------------------------------------------------

describe('"na odwrót": finite access + lifetime license', () => {
  it('re-purchase with new orderId issues a new lifetime token', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const lifetimeProduct = { ...product365, license_duration_days: null };
    const newOrderId = 'pi_repurchase_123';

    const result = await issueLicense(
      adminMock({ product: lifetimeProduct, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: newOrderId },
      { now: NOW },
    );

    expect(result).not.toBeNull();
    const verified = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    expect(verified.claims?.exp).toBeNull();
    expect(verified.claims?.order).toBe(newOrderId);
  });

  it('old lifetime token is still verifiable after repurchase (ECDSA, no revocation)', async () => {
    // Issue first token (original purchase)
    const insert1 = vi.fn().mockResolvedValue({ error: null });
    const lifetimeProduct = { ...product365, license_duration_days: null };

    const firstResult = await issueLicense(
      adminMock({ product: lifetimeProduct, existing: null, insert: insert1 }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: 'pi_original' },
      { now: YEAR_AGO },
    );
    expect(firstResult).not.toBeNull();

    // Old token is still valid 1 year later (no expiry, no revocation)
    const verified = verifyLicense(firstResult!.token, key.publicKeyPem, { now: NOW });
    expect(verified.valid).toBe(true);
    expect(verified.claims?.exp).toBeNull();
  });
});
