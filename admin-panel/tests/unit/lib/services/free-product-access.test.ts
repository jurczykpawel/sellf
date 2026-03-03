/**
 * Unit Tests: grantFreeProductAccess service
 *
 * Covers:
 * 1. New user — access granted + OTO generated
 * 2. User already has valid access — no re-grant, OTO still generated (idempotent)
 * 3. User had expired access — re-grant + OTO generated
 * 4. RPC grant fails → error returned, no OTO attempt
 * 5. RPC returns false (not free/not active) → error returned
 * 6. OTO generation fails → access still granted, otoInfo is null (graceful degradation)
 * 7. OTO not configured → accessGranted true, otoInfo null
 * 8. PWYW-free product (price > 0, custom_price_min = 0) → uses grant_pwyw_free_access RPC
 * 9. Regular free product (price = 0) → uses grant_free_product_access RPC
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

// ---------------------------------------------------------------------------
// Mock Supabase client builders
// ---------------------------------------------------------------------------

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

function makeSupabase({
  existingAccess = null as { access_expires_at: string | null } | null,
  existingAccessError = null as unknown,
  grantResult = true as unknown,
  grantError = null as unknown,
  rpcName = 'grant_free_product_access',
} = {}) {
  const builder = makeQueryBuilder({ data: existingAccess, error: existingAccessError });
  const rpc = vi.fn().mockResolvedValue({ data: grantResult, error: grantError });
  return {
    from: vi.fn().mockReturnValue(builder),
    rpc,
    _builder: builder,
  };
}

function makeAdminClient({
  otoResult = null as Record<string, unknown> | null,
  otoError = null as unknown,
} = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: otoResult, error: otoError }),
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FREE_PRODUCT = { id: 'prod-1', slug: 'my-free-product', price: 0, isPwywFree: false };
const PWYW_PRODUCT = { id: 'prod-2', slug: 'my-pwyw-product', price: 500, isPwywFree: true };
const TEST_USER = { id: 'user-1', email: 'test@example.com' };
const OTO_RESULT = {
  has_oto: true,
  oto_product_slug: 'upsell-product',
  oto_product_name: 'Upsell',
  coupon_code: 'OTO-ABC123',
  discount_type: 'percentage',
  discount_value: 30,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('grantFreeProductAccess()', () => {
  describe('new user (no existing access)', () => {
    it('grants access and returns otoInfo when OTO is configured', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = makeAdminClient({ otoResult: OTO_RESULT });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(false);
      expect(result.otoInfo).toEqual(OTO_RESULT);
      expect(result.error).toBeUndefined();

      // Verify grant RPC was called
      expect(supabase.rpc).toHaveBeenCalledWith('grant_free_product_access', {
        product_slug_param: FREE_PRODUCT.slug,
      });

      // Verify OTO RPC was called
      expect(adminClient.rpc).toHaveBeenCalledWith('generate_oto_coupon', {
        source_product_id_param: FREE_PRODUCT.id,
        customer_email_param: TEST_USER.email,
      });
    });

    it('grants access with otoInfo null when no OTO is configured', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = makeAdminClient({ otoResult: { has_oto: false } });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toBeNull();
    });
  });

  describe('user already has valid access', () => {
    it('skips re-grant but still generates OTO (idempotent)', async () => {
      const supabase = makeSupabase({
        existingAccess: { access_expires_at: null }, // permanent access
        grantResult: true,
      });
      const adminClient = makeAdminClient({ otoResult: OTO_RESULT });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(true);
      expect(result.otoInfo).toEqual(OTO_RESULT);

      // Grant RPC must NOT be called again
      expect(supabase.rpc).not.toHaveBeenCalled();

      // OTO RPC must still be called
      expect(adminClient.rpc).toHaveBeenCalledWith('generate_oto_coupon', expect.any(Object));
    });

    it('skips re-grant for non-expired timed access', async () => {
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();
      const supabase = makeSupabase({ existingAccess: { access_expires_at: futureDate } });
      const adminClient = makeAdminClient({ otoResult: OTO_RESULT });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.alreadyHadAccess).toBe(true);
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('user has expired access', () => {
    it('re-grants access and generates OTO', async () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      const supabase = makeSupabase({
        existingAccess: { access_expires_at: pastDate },
        grantResult: true,
      });
      const adminClient = makeAdminClient({ otoResult: OTO_RESULT });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(false);
      expect(supabase.rpc).toHaveBeenCalledWith('grant_free_product_access', expect.any(Object));
    });
  });

  describe('grant RPC failure', () => {
    it('returns error when RPC returns a DB error', async () => {
      const supabase = makeSupabase({
        existingAccess: null,
        grantResult: null,
        grantError: { message: 'DB error' },
      });
      const adminClient = makeAdminClient({ otoResult: OTO_RESULT });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(false);
      expect(result.error).toBe('Failed to grant access');

      // OTO must not be attempted after a grant failure
      expect(adminClient.rpc).not.toHaveBeenCalled();
    });

    it('returns error when RPC returns false (product not free/active)', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: false, grantError: null });
      const adminClient = makeAdminClient({ otoResult: OTO_RESULT });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(false);
      expect(result.error).toMatch(/not be free or active/);
      expect(adminClient.rpc).not.toHaveBeenCalled();
    });
  });

  describe('OTO generation failure (graceful degradation)', () => {
    it('still returns accessGranted=true when OTO RPC errors', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = makeAdminClient({ otoError: { message: 'OTO RPC error' } });

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('still returns accessGranted=true when OTO RPC throws', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = { rpc: vi.fn().mockRejectedValue(new Error('Network error')) };

      const result = await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.accessGranted).toBe(true);
      expect(result.otoInfo).toBeNull();
    });
  });

  describe('RPC selection', () => {
    it('uses grant_free_product_access for regular free product (price=0)', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = makeAdminClient();

      await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: { ...FREE_PRODUCT, price: 0, isPwywFree: false }, user: TEST_USER },
      );

      expect(supabase.rpc).toHaveBeenCalledWith('grant_free_product_access', expect.any(Object));
    });

    it('uses grant_pwyw_free_access for PWYW product with price > 0', async () => {
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = makeAdminClient();

      await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: PWYW_PRODUCT, user: TEST_USER },
      );

      expect(supabase.rpc).toHaveBeenCalledWith('grant_pwyw_free_access', expect.any(Object));
    });

    it('uses grant_free_product_access for PWYW product with price = 0', async () => {
      // Edge case: PWYW with custom_price_min=0 AND price=0 → treated as regular free
      const supabase = makeSupabase({ existingAccess: null, grantResult: true });
      const adminClient = makeAdminClient();

      await grantFreeProductAccess(
        supabase as any,
        adminClient as any,
        { product: { ...PWYW_PRODUCT, price: 0 }, user: TEST_USER },
      );

      expect(supabase.rpc).toHaveBeenCalledWith('grant_free_product_access', expect.any(Object));
    });
  });
});
