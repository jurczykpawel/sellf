/**
 * Tests for seller admin server actions
 *
 * @see src/lib/actions/sellers.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== MOCKS =====

const { mockFrom, mockRpc, mockRevalidatePath } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockRevalidatePath = vi.fn();
  return { mockFrom, mockRpc, mockRevalidatePath };
});

// Mock createClient (for requireAdminApi)
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'admin-user-1', email: 'admin@test.com' } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'admin-1' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

// Mock createPlatformClient
vi.mock('@/lib/supabase/admin', () => ({
  createPlatformClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

// Mock feature flag
vi.mock('@/lib/marketplace/feature-flag', () => ({
  checkMarketplaceAccess: vi.fn().mockReturnValue({ accessible: true }),
}));

// Mock seller cache
vi.mock('@/lib/marketplace/seller-client', () => ({
  clearSellerCache: vi.fn(),
}));

// Mock revalidatePath
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

// ===== IMPORT AFTER MOCKS =====

import { listSellers, createSeller, updateSeller, deprovisionSeller } from '@/lib/actions/sellers';

// ===== HELPERS =====

function setupListChain(data: unknown[] | null, error: unknown = null) {
  const orderFn = vi.fn().mockResolvedValue({ data, error });
  const selectFn = vi.fn().mockReturnValue({ order: orderFn });
  mockFrom.mockReturnValue({ select: selectFn });
}

function setupUpdateChain(error: unknown = null) {
  const eqFn = vi.fn().mockResolvedValue({ error });
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
  mockFrom.mockReturnValue({ update: updateFn });
  return { updateFn, eqFn };
}

function setupSelectSingleChain(data: unknown, error: unknown = null) {
  const singleFn = vi.fn().mockResolvedValue({ data, error });
  const eqFn = vi.fn().mockReturnValue({ single: singleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  mockFrom.mockReturnValue({ select: selectFn });
}

// ===== TESTS =====

describe('Seller Admin Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== listSellers =====

  describe('listSellers', () => {
    it('should return list of sellers', async () => {
      const sellers = [
        { id: 's1', slug: 'nick', display_name: 'Nick', status: 'active' },
        { id: 's2', slug: 'alice', display_name: 'Alice', status: 'active' },
      ];
      setupListChain(sellers);

      const result = await listSellers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].slug).toBe('nick');
    });

    it('should return empty array when no sellers', async () => {
      setupListChain([]);

      const result = await listSellers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should return error on DB failure', async () => {
      setupListChain(null, { message: 'DB error' });

      const result = await listSellers();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to load');
    });
  });

  // ===== createSeller =====

  describe('createSeller', () => {
    it('should provision seller via RPC', async () => {
      mockRpc.mockResolvedValue({ data: 'new-seller-id', error: null });

      const result = await createSeller({
        slug: 'nick-green',
        displayName: 'Nick Green',
        email: 'nick@example.com',
        platformFeePercent: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data?.sellerId).toBe('new-seller-id');
      expect(mockRpc).toHaveBeenCalledWith('provision_seller_schema', {
        p_slug: 'nick-green',
        p_display_name: 'Nick Green',
      });
    });

    it('should reject invalid slug', async () => {
      const result = await createSeller({
        slug: 'INVALID SLUG!',
        displayName: 'Test',
        email: 'test@test.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Slug');
    });

    it('should reject slug with leading hyphen', async () => {
      const result = await createSeller({
        slug: '-bad-slug',
        displayName: 'Test',
        email: 'test@test.com',
      });

      expect(result.success).toBe(false);
    });

    it('should reject too short slug', async () => {
      const result = await createSeller({
        slug: 'ab',
        displayName: 'Test',
        email: 'test@test.com',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty display name', async () => {
      const result = await createSeller({
        slug: 'valid-slug',
        displayName: '',
        email: 'test@test.com',
      });

      expect(result.success).toBe(false);
    });

    it('should reject invalid email', async () => {
      const result = await createSeller({
        slug: 'valid-slug',
        displayName: 'Test',
        email: 'not-an-email',
      });

      expect(result.success).toBe(false);
    });

    it('should reject fee above 50%', async () => {
      const result = await createSeller({
        slug: 'valid-slug',
        displayName: 'Test',
        email: 'test@test.com',
        platformFeePercent: 51,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('fee');
    });

    it('should default fee to 5% (no extra update needed)', async () => {
      mockRpc.mockResolvedValue({ data: 'id', error: null });

      const result = await createSeller({
        slug: 'valid-slug',
        displayName: 'Test',
        email: 'test@test.com',
      });

      expect(result.success).toBe(true);
      // No extra update call since default is 5%
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should handle duplicate slug error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'Seller with this slug already exists' } });

      const result = await createSeller({
        slug: 'existing-slug',
        displayName: 'Test',
        email: 'test@test.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  // ===== updateSeller =====

  describe('updateSeller', () => {
    it('should update seller display name', async () => {
      const { updateFn } = setupUpdateChain();

      const result = await updateSeller('seller-1', { displayName: 'New Name' });

      expect(result.success).toBe(true);
      expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
        display_name: 'New Name',
      }));
    });

    it('should update platform fee', async () => {
      const { updateFn } = setupUpdateChain();

      const result = await updateSeller('seller-1', { platformFeePercent: 10 });

      expect(result.success).toBe(true);
      expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
        platform_fee_percent: 10,
      }));
    });

    it('should update status', async () => {
      const { updateFn } = setupUpdateChain();

      const result = await updateSeller('seller-1', { status: 'suspended' });

      expect(result.success).toBe(true);
      expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({
        status: 'suspended',
      }));
    });

    it('should reject invalid status', async () => {
      const result = await updateSeller('seller-1', { status: 'deleted' as 'active' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Status');
    });

    it('should reject empty seller ID', async () => {
      const result = await updateSeller('', { displayName: 'Test' });

      expect(result.success).toBe(false);
    });
  });

  // ===== deprovisionSeller =====

  describe('deprovisionSeller', () => {
    it('should deprovision seller via RPC', async () => {
      setupSelectSingleChain({ slug: 'nick', schema_name: 'seller_nick' });
      mockRpc.mockResolvedValue({ error: null });

      const result = await deprovisionSeller('seller-1');

      expect(result.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('deprovision_seller_schema', {
        p_seller_id: 'seller-1',
      });
    });

    it('should prevent deprovisioning the owner', async () => {
      setupSelectSingleChain({ slug: 'owner', schema_name: 'seller_main' });

      const result = await deprovisionSeller('owner-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('platform owner');
    });

    it('should handle seller not found', async () => {
      setupSelectSingleChain(null, { message: 'Not found' });

      const result = await deprovisionSeller('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject empty seller ID', async () => {
      const result = await deprovisionSeller('');

      expect(result.success).toBe(false);
    });
  });
});
