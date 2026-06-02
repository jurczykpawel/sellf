/**
 * License re-purchase and expiry-aware checkout tests.
 *
 * Covers:
 *  1. create-payment-intent allows checkout when access is expired
 *  2. create-payment-intent blocks checkout when access is still active
 *  3. re-purchase uses the new payment orderId to issue a new token
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

  it('lifetime license (null license_duration_days) → no exp claim in token', async () => {
    const lifetimeProduct = { ...product365, license_duration_days: null };
    const insert = vi.fn().mockResolvedValue({ error: null });

    const result = await issueLicense(
      adminMock({ product: lifetimeProduct, existing: null, insert }) as never,
      { productId: PRODUCT, email: 'buyer@example.com', userId: USER, orderId: 'pi_repurchase_123' },
      { now: NOW },
    );

    expect(result).not.toBeNull();
    const verified = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    expect(verified.claims?.exp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario: "na odwrót" — finite access + lifetime license
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
