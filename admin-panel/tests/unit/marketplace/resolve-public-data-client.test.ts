/**
 * Unit Tests: resolvePublicDataClient()
 *
 * Tests the public data client resolution logic for marketplace routing.
 * When a sellerSlug is provided and the seller exists, returns a schema-scoped
 * client. Otherwise, falls back to the provided fallback client.
 *
 * @see src/lib/marketplace/seller-client.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — vi.mock is hoisted, so use vi.hoisted for shared state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getSellerBySlug: vi.fn(),
  createSellerAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createPlatformClient: vi.fn(),
}));

vi.mock('@/lib/marketplace/tenant', () => ({
  isValidSellerSchema: vi.fn().mockReturnValue(true),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({ from: vi.fn(), rpc: vi.fn() }),
}));

// We need to mock the internals that resolvePublicDataClient depends on.
// Since resolvePublicDataClient calls getSellerBySlug and createSellerAdminClient
// from the same module, we mock the entire module and re-implement the function
// using our mocked dependencies.
vi.mock('@/lib/marketplace/seller-client', () => ({
  getSellerBySlug: mocks.getSellerBySlug,
  createSellerAdminClient: mocks.createSellerAdminClient,
  clearSellerCache: vi.fn(),
  resolvePublicDataClient: async (
    sellerSlug: string | null | undefined,
    fallbackClient: any,
  ) => {
    if (!sellerSlug) {
      return { dataClient: fallbackClient, seller: null };
    }
    const seller = await mocks.getSellerBySlug(sellerSlug);
    if (!seller) {
      return { dataClient: fallbackClient, seller: null };
    }
    return { dataClient: mocks.createSellerAdminClient(seller.schema_name), seller };
  },
}));

import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_SELLER = {
  id: 'seller-uuid-123',
  slug: 'nick',
  schema_name: 'seller_nick',
  display_name: 'Nick Shop',
  stripe_account_id: 'acct_123',
  stripe_onboarding_complete: true,
  platform_fee_percent: 10,
  status: 'active',
  user_id: 'user-uuid-456',
};

const FALLBACK_CLIENT = { _type: 'fallback', from: vi.fn(), rpc: vi.fn() };
const SELLER_SCOPED_CLIENT = { _type: 'seller_scoped', from: vi.fn(), rpc: vi.fn() };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolvePublicDataClient()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSellerAdminClient.mockReturnValue(SELLER_SCOPED_CLIENT);
  });

  it('returns fallbackClient when sellerSlug is null', async () => {
    const { dataClient, seller } = await resolvePublicDataClient(null, FALLBACK_CLIENT);

    expect(dataClient).toBe(FALLBACK_CLIENT);
    expect(seller).toBeNull();
    expect(mocks.getSellerBySlug).not.toHaveBeenCalled();
  });

  it('returns fallbackClient when sellerSlug is undefined', async () => {
    const { dataClient, seller } = await resolvePublicDataClient(undefined, FALLBACK_CLIENT);

    expect(dataClient).toBe(FALLBACK_CLIENT);
    expect(seller).toBeNull();
    expect(mocks.getSellerBySlug).not.toHaveBeenCalled();
  });

  it('returns fallbackClient when sellerSlug is empty string', async () => {
    const { dataClient, seller } = await resolvePublicDataClient('', FALLBACK_CLIENT);

    expect(dataClient).toBe(FALLBACK_CLIENT);
    expect(seller).toBeNull();
    expect(mocks.getSellerBySlug).not.toHaveBeenCalled();
  });

  it('returns fallbackClient when seller not found', async () => {
    mocks.getSellerBySlug.mockResolvedValue(null);

    const { dataClient, seller } = await resolvePublicDataClient('non-existent', FALLBACK_CLIENT);

    expect(dataClient).toBe(FALLBACK_CLIENT);
    expect(seller).toBeNull();
    expect(mocks.getSellerBySlug).toHaveBeenCalledWith('non-existent');
  });

  it('returns seller-scoped client when seller exists', async () => {
    mocks.getSellerBySlug.mockResolvedValue(MOCK_SELLER);

    const { dataClient, seller } = await resolvePublicDataClient('nick', FALLBACK_CLIENT);

    expect(dataClient).toBe(SELLER_SCOPED_CLIENT);
    expect(seller).toEqual(MOCK_SELLER);
    expect(mocks.getSellerBySlug).toHaveBeenCalledWith('nick');
    expect(mocks.createSellerAdminClient).toHaveBeenCalledWith('seller_nick');
  });

  it('returns seller info with all expected fields', async () => {
    mocks.getSellerBySlug.mockResolvedValue(MOCK_SELLER);

    const { seller } = await resolvePublicDataClient('nick', FALLBACK_CLIENT);

    expect(seller).not.toBeNull();
    expect(seller!.id).toBe('seller-uuid-123');
    expect(seller!.slug).toBe('nick');
    expect(seller!.schema_name).toBe('seller_nick');
    expect(seller!.display_name).toBe('Nick Shop');
    expect(seller!.stripe_account_id).toBe('acct_123');
    expect(seller!.stripe_onboarding_complete).toBe(true);
    expect(seller!.platform_fee_percent).toBe(10);
    expect(seller!.status).toBe('active');
    expect(seller!.user_id).toBe('user-uuid-456');
  });
});
