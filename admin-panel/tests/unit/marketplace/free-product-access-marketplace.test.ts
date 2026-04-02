/**
 * Unit Tests: grantFreeProductAccess — marketplace routing
 *
 * Tests the marketplace-specific branching in grantFreeProductAccess():
 * - When adminClient !== userClient (marketplace): uses grant_product_access_service_role
 *   RPC with user_id_param + product_id_param
 * - When adminClient === userClient (platform): uses grant_free_product_access RPC
 *   with product_slug_param
 * - Access check always uses adminClient (not userClient)
 * - OTO generation always uses adminClient
 *
 * @see src/lib/services/free-product-access.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

function makeClient({
  existingAccess = null as { access_expires_at: string | null } | null,
  rpcResult = true as unknown,
  rpcError = null as unknown,
  otoResult = null as Record<string, unknown> | null,
  otoError = null as unknown,
} = {}) {
  const accessBuilder = makeQueryBuilder({ data: existingAccess, error: null });
  const rpc = vi.fn().mockImplementation((name: string) => {
    if (name === 'generate_oto_coupon') {
      return Promise.resolve({ data: otoResult, error: otoError });
    }
    return Promise.resolve({ data: rpcResult, error: rpcError });
  });
  return {
    from: vi.fn().mockReturnValue(accessBuilder),
    rpc,
    _accessBuilder: accessBuilder,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FREE_PRODUCT = { id: 'prod-1', slug: 'free-ebook', price: 0, isPwywFree: false };
const TEST_USER = { id: 'user-1', email: 'buyer@example.com' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('grantFreeProductAccess() — marketplace routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('marketplace path (adminClient !== userClient)', () => {
    it('uses grant_product_access_service_role with user_id_param and product_id_param', async () => {
      const userClient = makeClient({ existingAccess: null });
      const adminClient = makeClient({ existingAccess: null, rpcResult: true });

      await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      // The grant RPC should be called on adminClient, not userClient
      expect(adminClient.rpc).toHaveBeenCalledWith('grant_product_access_service_role', {
        user_id_param: TEST_USER.id,
        product_id_param: FREE_PRODUCT.id,
      });

      // userClient.rpc should NOT be called for grant (only adminClient)
      const userRpcCalls = userClient.rpc.mock.calls.filter(
        (call: unknown[]) => call[0] !== 'generate_oto_coupon',
      );
      expect(userRpcCalls).toHaveLength(0);
    });

    it('checks existing access via adminClient (not userClient)', async () => {
      const userClient = makeClient();
      const adminClient = makeClient({ existingAccess: { access_expires_at: null } });

      await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      // Access check (from('user_product_access')) should be on adminClient
      expect(adminClient.from).toHaveBeenCalledWith('user_product_access');
    });

    it('generates OTO via adminClient', async () => {
      const userClient = makeClient();
      const adminClient = makeClient({
        existingAccess: null,
        rpcResult: true,
        otoResult: { has_oto: true, coupon_code: 'OTO-123' },
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(adminClient.rpc).toHaveBeenCalledWith('generate_oto_coupon', {
        source_product_id_param: FREE_PRODUCT.id,
        customer_email_param: TEST_USER.email,
      });
      expect(result.otoInfo).toEqual({ has_oto: true, coupon_code: 'OTO-123' });
    });
  });

  describe('platform path (adminClient === userClient)', () => {
    it('uses grant_free_product_access with product_slug_param', async () => {
      const sameClient = makeClient({ existingAccess: null, rpcResult: true });

      await grantFreeProductAccess(
        sameClient as any,
        sameClient as any, // same reference = platform mode
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(sameClient.rpc).toHaveBeenCalledWith('grant_free_product_access', {
        product_slug_param: FREE_PRODUCT.slug,
      });
    });

    it('does NOT call grant_product_access_service_role for platform path', async () => {
      const sameClient = makeClient({ existingAccess: null, rpcResult: true });

      await grantFreeProductAccess(
        sameClient as any,
        sameClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      const serviceRoleCalls = sameClient.rpc.mock.calls.filter(
        (call: unknown[]) => call[0] === 'grant_product_access_service_role',
      );
      expect(serviceRoleCalls).toHaveLength(0);
    });
  });

  describe('alreadyHadAccess handling', () => {
    it('returns alreadyHadAccess=true when access exists (permanent)', async () => {
      const userClient = makeClient();
      const adminClient = makeClient({ existingAccess: { access_expires_at: null } });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.alreadyHadAccess).toBe(true);
      expect(result.accessGranted).toBe(true);

      // No grant RPC should be called when access already exists
      const grantCalls = adminClient.rpc.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === 'grant_product_access_service_role' ||
          call[0] === 'grant_free_product_access',
      );
      expect(grantCalls).toHaveLength(0);
    });

    it('returns alreadyHadAccess=true when access exists (not expired)', async () => {
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();
      const userClient = makeClient();
      const adminClient = makeClient({ existingAccess: { access_expires_at: futureDate } });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.alreadyHadAccess).toBe(true);
    });

    it('re-grants when access is expired (marketplace path)', async () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      const userClient = makeClient();
      const adminClient = makeClient({
        existingAccess: { access_expires_at: pastDate },
        rpcResult: true,
      });

      const result = await grantFreeProductAccess(
        userClient as any,
        adminClient as any,
        { product: FREE_PRODUCT, user: TEST_USER },
      );

      expect(result.alreadyHadAccess).toBe(false);
      expect(result.accessGranted).toBe(true);
      expect(adminClient.rpc).toHaveBeenCalledWith('grant_product_access_service_role', {
        user_id_param: TEST_USER.id,
        product_id_param: FREE_PRODUCT.id,
      });
    });
  });
});
