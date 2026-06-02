/**
 * Tests verifying that issueLicense is safe to call in "replay" scenarios:
 * - already_had_access=true (idempotent webhook replay via DB function)
 * - already_processed early return (duplicate Stripe event delivery)
 *
 * These map to the two webhook handler code paths that previously skipped
 * issueLicense entirely. After the fix both paths call issueLicense — which
 * is correct because issueLicense is idempotent by (order_id, product_id).
 */

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
const NOW = new Date(2_000_000 * 1000);
const key = generateSellerKeypair();

interface ProductRow {
  seller_id: string;
  slug: string;
  issue_license_on_purchase: boolean;
  license_tier: string | null;
  license_duration_days: number | null;
}

function adminMock(opts: {
  product?: ProductRow | null;
  existing?: { license_key: string; kid: string; seller_id: string } | null;
  insert?: ReturnType<typeof vi.fn>;
}) {
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
  seller_id: SELLER, slug: 'my-product', issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: null, ...over,
});

const issue = (admin: unknown, orderId = 'pi_abc123') =>
  issueLicense(admin as never, { productId: PRODUCT, email: 'buyer@example.com', userId: 'user-uuid', orderId }, { now: NOW });

beforeEach(() => {
  vi.mocked(loadActiveSellerKey).mockReset();
  vi.mocked(loadActiveSellerKey).mockResolvedValue({ kid: key.kid, publicKeyPem: key.publicKeyPem, privateKeyPem: key.privateKeyPem });
});

describe('issueLicense — replay safety (already_had_access / already_processed scenarios)', () => {
  it('issues a license on first call (baseline)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const result = await issue(adminMock({ product: product(), insert }));
    expect(result).toBeTruthy();
    expect(insert).toHaveBeenCalledOnce();
    const verified = verifyLicense(result!.token, key.publicKeyPem, { now: NOW });
    expect(verified).toMatchObject({ valid: true, claims: { product: 'my-product', email: 'buyer@example.com', order: 'pi_abc123' } });
  });

  it('on replay with same order_id, returns existing token without re-inserting (idempotent)', async () => {
    // Simulate: first call issues the license, second call (replay) finds existing
    const insert = vi.fn();
    const existing = { license_key: 'EXISTING.SIGNED.TOKEN', kid: key.kid, seller_id: SELLER };
    const result = await issue(adminMock({ product: product(), existing, insert }));
    expect(result).toEqual({ token: 'EXISTING.SIGNED.TOKEN', kid: key.kid, sellerId: SELLER });
    expect(insert).not.toHaveBeenCalled();
  });

  it('on replay with same order_id (already_had_access=true scenario), still returns the license', async () => {
    // This covers the webhook path where already_had_access=true was previously
    // preventing issueLicense from being called at all.
    // After the fix: issueLicense IS called, and since it's idempotent it returns
    // the previously issued license.
    const existing = { license_key: 'FIRST.ISSUED.TOKEN', kid: key.kid, seller_id: SELLER };
    const result = await issue(adminMock({ product: product(), existing }));
    expect(result).not.toBeNull();
    expect(result!.token).toBe('FIRST.ISSUED.TOKEN');
  });

  it('on replay when no license was issued before (old code path), issues it now', async () => {
    // Simulates: purchase completed with old code (no license issued),
    // then webhook retried or second purchase triggers replay path.
    // issueLicense finds no existing row → issues fresh license.
    const insert = vi.fn().mockResolvedValue({ error: null });
    const result = await issue(adminMock({ product: product(), existing: null, insert }));
    expect(result).toBeTruthy();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      seller_id: SELLER,
      product_id: PRODUCT,
      order_id: 'pi_abc123',
      email: 'buyer@example.com',
      user_id: 'user-uuid',
    }));
  });

  it('does not issue when product has issue_license_on_purchase=false (even on replay)', async () => {
    const insert = vi.fn();
    const result = await issue(adminMock({ product: product({ issue_license_on_purchase: false }), insert }));
    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not issue when seller has no active key (even on replay)', async () => {
    vi.mocked(loadActiveSellerKey).mockResolvedValue(null);
    const insert = vi.fn();
    const result = await issue(adminMock({ product: product(), insert }));
    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});
