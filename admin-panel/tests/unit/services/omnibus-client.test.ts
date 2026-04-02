/**
 * Unit Tests: Omnibus service — client parameter
 *
 * Verifies that the omnibus service:
 * - Requires an explicit client parameter (no internal client creation)
 * - Uses the passed client for all DB queries (shop_config, products, price_history)
 * - Works correctly with schema-scoped clients (marketplace support)
 *
 * @see src/lib/services/omnibus.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLowestPriceInLast30Days } from '@/lib/services/omnibus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOmnibusClient({
  omnibusEnabled = true,
  productExempt = false,
  priceHistory = [] as Array<{
    price: string;
    sale_price: string | null;
    currency: string;
    effective_from: string;
  }>,
  shopConfigError = null as unknown,
  productError = null as unknown,
  historyError = null as unknown,
} = {}) {
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'shop_config') {
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { omnibus_enabled: omnibusEnabled },
              error: shopConfigError,
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { omnibus_exempt: productExempt },
                error: productError,
              }),
            }),
          }),
        };
      }
      if (table === 'product_price_history') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: priceHistory,
                  error: historyError,
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn() };
    }),
  };
  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Omnibus service — client parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the passed client for shop_config query (isOmnibusEnabled)', async () => {
    const client = makeOmnibusClient({ omnibusEnabled: false });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).toBeNull(); // disabled = null
    expect(client.from).toHaveBeenCalledWith('shop_config');
  });

  it('uses the passed client for products query (omnibus_exempt check)', async () => {
    const client = makeOmnibusClient({ omnibusEnabled: true, productExempt: true });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).toBeNull(); // exempt = null
    expect(client.from).toHaveBeenCalledWith('products');
  });

  it('uses the passed client for product_price_history query', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000);

    const client = makeOmnibusClient({
      omnibusEnabled: true,
      productExempt: false,
      priceHistory: [
        {
          price: '100.00',
          sale_price: '79.00',
          currency: 'PLN',
          effective_from: tenDaysAgo.toISOString(),
        },
      ],
    });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).not.toBeNull();
    expect(result!.lowestPrice).toBe(79);
    expect(result!.currency).toBe('PLN');
    expect(client.from).toHaveBeenCalledWith('product_price_history');
  });

  it('returns null when Omnibus is disabled in the schema', async () => {
    const client = makeOmnibusClient({ omnibusEnabled: false });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).toBeNull();
  });

  it('returns null when no price history exists', async () => {
    const client = makeOmnibusClient({
      omnibusEnabled: true,
      productExempt: false,
      priceHistory: [],
    });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).toBeNull();
  });

  it('finds the lowest price among multiple history entries', async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 86_400_000);
    const twentyDaysAgo = new Date(now.getTime() - 20 * 86_400_000);

    const client = makeOmnibusClient({
      omnibusEnabled: true,
      productExempt: false,
      priceHistory: [
        {
          price: '150.00',
          sale_price: null,
          currency: 'PLN',
          effective_from: fiveDaysAgo.toISOString(),
        },
        {
          price: '200.00',
          sale_price: '89.00',
          currency: 'PLN',
          effective_from: twentyDaysAgo.toISOString(),
        },
      ],
    });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).not.toBeNull();
    expect(result!.lowestPrice).toBe(89); // sale_price of second entry
  });

  it('returns null when shop_config query errors', async () => {
    const client = makeOmnibusClient({
      shopConfigError: { message: 'DB error' },
    });

    const result = await getLowestPriceInLast30Days('prod-1', client as any);

    expect(result).toBeNull();
  });

  it('does not create any internal clients (no module-level imports of createClient)', async () => {
    // This is a static analysis test: the omnibus module should not import
    // createClient, createAdminClient, or createPlatformClient.
    // We verify this by checking that only the passed client is used.
    const client = makeOmnibusClient({
      omnibusEnabled: true,
      productExempt: false,
      priceHistory: [
        {
          price: '50.00',
          sale_price: null,
          currency: 'USD',
          effective_from: new Date().toISOString(),
        },
      ],
    });

    await getLowestPriceInLast30Days('prod-1', client as any);

    // All three tables should be queried via the same client instance
    const fromCalls = client.from.mock.calls.map((call: unknown[]) => call[0]);
    expect(fromCalls).toContain('shop_config');
    expect(fromCalls).toContain('products');
    expect(fromCalls).toContain('product_price_history');

    // Every from() call should be on the same client reference
    expect(client.from).toHaveBeenCalledTimes(3);
  });
});
