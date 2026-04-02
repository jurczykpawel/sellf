/**
 * Unit Tests: Shop config isolation (marketplace vs platform)
 *
 * Tests that shop config functions use the correct client:
 * - getMyShopConfig() uses withAdminOrSellerAuth (schema-scoped dataClient)
 * - getShopConfig() uses createPublicClient (platform-wide, for public pages)
 * - getMyDefaultCurrency() returns currency from caller's own schema
 * - updateShopConfig() reads config ID from dataClient, not platform
 *
 * @see src/lib/actions/shop-config.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockWithAdminOrSellerAuth = vi.fn();
const mockCreatePublicClient = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDel = vi.fn();
const mockRevalidatePath = vi.fn();
const mockIsDemoMode = vi.fn();

vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminOrSellerAuth: (...args: unknown[]) => mockWithAdminOrSellerAuth(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: () => mockCreatePublicClient(),
}));

vi.mock('@/lib/redis/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CacheKeys: { SHOP_CONFIG: 'shop_config' },
  CacheTTL: { LONG: 3600 },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock('react', () => ({
  cache: (fn: Function) => fn, // passthrough - no caching in tests
}));

vi.mock('@/lib/demo-guard', () => ({
  isDemoMode: () => mockIsDemoMode(),
}));

// Import AFTER mocks are set up
import {
  getShopConfig,
  getMyShopConfig,
  getMyDefaultCurrency,
  updateShopConfig,
} from '@/lib/actions/shop-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHOP_CONFIG_FIXTURE = {
  id: 'config-1',
  default_currency: 'PLN',
  shop_name: 'Test Shop',
  tax_mode: 'local' as const,
  stripe_tax_rate_cache: {},
  omnibus_enabled: false,
  custom_settings: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.update = vi.fn().mockReturnValue(builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Shop config isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null); // no Redis cache
    mockCacheSet.mockResolvedValue(undefined);
    mockCacheDel.mockResolvedValue(undefined);
    mockIsDemoMode.mockReturnValue(false);
  });

  describe('getShopConfig()', () => {
    it('uses createPublicClient (platform-wide, not schema-scoped)', async () => {
      const publicBuilder = makeQueryBuilder({ data: SHOP_CONFIG_FIXTURE, error: null });
      const publicClient = { from: vi.fn().mockReturnValue(publicBuilder) };
      mockCreatePublicClient.mockReturnValue(publicClient);

      const config = await getShopConfig();

      expect(mockCreatePublicClient).toHaveBeenCalled();
      expect(publicClient.from).toHaveBeenCalledWith('shop_config');
      expect(config).toEqual(SHOP_CONFIG_FIXTURE);
    });

    it('returns cached config from Redis when available', async () => {
      mockCacheGet.mockResolvedValue(SHOP_CONFIG_FIXTURE);

      const config = await getShopConfig();

      expect(config).toEqual(SHOP_CONFIG_FIXTURE);
      expect(mockCreatePublicClient).not.toHaveBeenCalled(); // skipped DB
    });
  });

  describe('getMyShopConfig()', () => {
    it('uses withAdminOrSellerAuth to get schema-scoped dataClient', async () => {
      mockWithAdminOrSellerAuth.mockImplementation(async (fn: Function) => {
        const dataClientBuilder = makeQueryBuilder({ data: SHOP_CONFIG_FIXTURE, error: null });
        const dataClient = { from: vi.fn().mockReturnValue(dataClientBuilder) };
        return fn({ dataClient, user: { id: 'u1' }, role: 'seller_admin' });
      });

      const config = await getMyShopConfig();

      expect(mockWithAdminOrSellerAuth).toHaveBeenCalledTimes(1);
      expect(config).toEqual(SHOP_CONFIG_FIXTURE);
    });

    it('returns null when withAdminOrSellerAuth fails', async () => {
      mockWithAdminOrSellerAuth.mockResolvedValue({
        success: false,
        error: 'Forbidden',
        errorCode: 'FORBIDDEN',
      });

      const config = await getMyShopConfig();

      expect(config).toBeNull();
    });
  });

  describe('getMyDefaultCurrency()', () => {
    it('returns currency from caller own schema via getMyShopConfig', async () => {
      const sellerConfig = { ...SHOP_CONFIG_FIXTURE, default_currency: 'EUR' };
      mockWithAdminOrSellerAuth.mockImplementation(async (fn: Function) => {
        const dataClientBuilder = makeQueryBuilder({ data: sellerConfig, error: null });
        const dataClient = { from: vi.fn().mockReturnValue(dataClientBuilder) };
        return fn({ dataClient, user: { id: 'u1' }, role: 'seller_admin' });
      });

      const currency = await getMyDefaultCurrency();

      expect(currency).toBe('EUR');
    });

    it('falls back to USD when no config found', async () => {
      mockWithAdminOrSellerAuth.mockResolvedValue({
        success: false,
        error: 'Forbidden',
      });

      const currency = await getMyDefaultCurrency();

      expect(currency).toBe('USD');
    });
  });

  describe('updateShopConfig()', () => {
    it('reads config ID from dataClient (schema-scoped), not platform', async () => {
      const updateBuilder: Record<string, unknown> = {};
      updateBuilder.update = vi.fn().mockReturnValue(updateBuilder);
      updateBuilder.eq = vi.fn().mockResolvedValue({ error: null });

      const selectBuilder = makeQueryBuilder({ data: { id: 'config-seller-1' }, error: null });

      const dataClient = {
        from: vi.fn().mockImplementation((table: string) => {
          // First call: select('id') to get config ID
          // Second call: update() to write changes
          return {
            select: selectBuilder.select,
            eq: selectBuilder.eq,
            maybeSingle: selectBuilder.maybeSingle,
            update: updateBuilder.update,
          };
        }),
      };

      mockWithAdminOrSellerAuth.mockImplementation(async (fn: Function) => {
        return fn({
          dataClient,
          user: { id: 'u1' },
          role: 'seller_admin',
        });
      });

      const success = await updateShopConfig({ shop_name: 'Updated Name' });

      expect(success).toBe(true);
      expect(mockWithAdminOrSellerAuth).toHaveBeenCalledTimes(1);
      // dataClient.from should be called for shop_config (not platform)
      expect(dataClient.from).toHaveBeenCalledWith('shop_config');
    });

    it('returns false in demo mode', async () => {
      mockIsDemoMode.mockReturnValue(true);

      const success = await updateShopConfig({ shop_name: 'Should Fail' });

      expect(success).toBe(false);
      expect(mockWithAdminOrSellerAuth).not.toHaveBeenCalled();
    });
  });
});
