/**
 * Unit Tests: grantFreeProductAccess — TS-layer orchestration only
 *
 * SCOPE: this file tests the TypeScript glue inside grantFreeProductAccess —
 * the existing-access check, the alreadyHadAccess flag, OTO graceful
 * degradation. It does NOT test the RPC contract itself (that lives in the
 * integration suite `tests/unit/integration/free-product-access-service.test.ts`
 * which runs against real Supabase).
 *
 * WHY both suites:
 *   - Mock-based (here): fast, deterministic, covers error paths that are hard
 *     to trigger against a real DB (e.g. "OTO RPC throws").
 *   - Integration: catches any drift between the service and the real DB
 *     contract — the thing mocks CAN'T catch, and the reason an earlier
 *     mock-only version of this file missed a production bug.
 *
 * RULE: mocks here must assert only on TS behaviour (branching, flag setting,
 * try/catch coverage). Anything that claims "the RPC does X" belongs in the
 * integration suite, not here.
 */

import { describe, it, expect, vi } from 'vitest';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

function makeUserClient({ grantResult = true as unknown, grantError = null as unknown } = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: grantResult, error: grantError }),
  };
}

function makeAdminClient({
  existingAccess = null as { access_expires_at: string | null } | null,
  otoResult = null as Record<string, unknown> | null,
  otoError = null as unknown,
  otoThrows = false,
} = {}) {
  const selectChain: Record<string, unknown> = {};
  selectChain.select = vi.fn().mockReturnValue(selectChain);
  selectChain.eq = vi.fn().mockReturnValue(selectChain);
  selectChain.single = vi.fn().mockResolvedValue({ data: existingAccess, error: null });

  const rpc = otoThrows
    ? vi.fn().mockRejectedValue(new Error('OTO RPC network error'))
    : vi.fn().mockResolvedValue({ data: otoResult, error: otoError });

  return {
    from: vi.fn().mockReturnValue(selectChain),
    rpc,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = { id: 'prod-1', slug: 'my-product' };
const USER = { id: 'user-1', email: 'user@example.com' };
const OTO_RESULT = {
  has_oto: true,
  oto_product_slug: 'upsell',
  oto_product_name: 'Upsell',
  coupon_code: 'OTO-ABC',
  discount_type: 'percentage',
  discount_value: 30,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('grantFreeProductAccess — TS orchestration', () => {
  describe('existing-access detection', () => {
    it('marks alreadyHadAccess=true when a non-expired UPA row exists and skips the RPC', async () => {
      const userClient = makeUserClient();
      const adminClient = makeAdminClient({
        existingAccess: { access_expires_at: null }, // permanent
        otoResult: OTO_RESULT,
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(true);
      // The grant RPC must NOT be called — access is already granted.
      expect(userClient.rpc).not.toHaveBeenCalled();
      // But OTO is still generated (idempotent upsell hook).
      expect(adminClient.rpc).toHaveBeenCalledWith('generate_oto_coupon', expect.any(Object));
    });

    it('treats expired access as missing and calls the grant RPC', async () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({
        existingAccess: { access_expires_at: pastDate },
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(false);
      expect(userClient.rpc).toHaveBeenCalledWith(
        'grant_free_product_access',
        expect.objectContaining({ product_slug_param: PRODUCT.slug }),
      );
    });
  });

  describe('RPC call shape', () => {
    it('passes couponCode through to the unified RPC when supplied', async () => {
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({ existingAccess: null });

      await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER, couponCode: 'VIP100' },
      );

      expect(userClient.rpc).toHaveBeenCalledWith('grant_free_product_access', {
        product_slug_param: PRODUCT.slug,
        coupon_code_param: 'VIP100',
      });
    });

    it('passes coupon_code_param: null when no coupon is supplied', async () => {
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({ existingAccess: null });

      await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(userClient.rpc).toHaveBeenCalledWith('grant_free_product_access', {
        product_slug_param: PRODUCT.slug,
        coupon_code_param: null,
      });
    });
  });

  describe('RPC failure', () => {
    it('returns error and does NOT attempt OTO when the grant RPC reports a DB error', async () => {
      const userClient = makeUserClient({ grantResult: null, grantError: { message: 'boom' } });
      const adminClient = makeAdminClient({ existingAccess: null });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(false);
      expect(result.error).toBe('Failed to grant access');
      // OTO must not be attempted after a grant failure.
      expect(adminClient.rpc).not.toHaveBeenCalled();
    });

    it('returns error when the grant RPC returns false (not eligible)', async () => {
      const userClient = makeUserClient({ grantResult: false });
      const adminClient = makeAdminClient({ existingAccess: null });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER, couponCode: 'INVALID' },
      );

      expect(result.accessGranted).toBe(false);
      expect(result.error).toMatch(/product may not be free or the coupon is invalid/);
      expect(adminClient.rpc).not.toHaveBeenCalled();
    });
  });

  describe('OTO graceful degradation', () => {
    it('still returns accessGranted=true when OTO RPC reports an error', async () => {
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({
        existingAccess: null,
        otoError: { message: 'oto failure' },
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('still returns accessGranted=true when OTO RPC throws', async () => {
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({ existingAccess: null, otoThrows: true });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toBeNull();
    });

    it('returns otoInfo=null when OTO RPC returns has_oto=false', async () => {
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({
        existingAccess: null,
        otoResult: { has_oto: false },
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toBeNull();
    });

    it('returns otoInfo payload when OTO is configured', async () => {
      const userClient = makeUserClient({ grantResult: true });
      const adminClient = makeAdminClient({
        existingAccess: null,
        otoResult: OTO_RESULT,
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: PRODUCT, user: USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toEqual(OTO_RESULT);
    });
  });
});
