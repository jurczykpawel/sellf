import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchAllProductsForDropdown } from '@/hooks/useProducts';

// The picker backing this hook (webhook per-product scoping, variant groups)
// renders every returned product as a checkbox and relies on getting the full
// catalogue back in one call. The underlying /api/v1/products endpoint caps
// each page at 100 rows (MAX_LIMIT) regardless of the requested `limit`, so a
// single request silently truncates any catalogue larger than that. This test
// pins the fix: the loader must follow `next_cursor` until `has_more` is
// false so a product ranked beyond the first page is still returned.
describe('fetchAllProductsForDropdown', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('follows cursor pagination across multiple pages instead of returning only the first page', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}` }));
    const pageTwo = [{ id: 'p-last', name: 'Zzz Last Product' }];

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: pageOne,
          pagination: { next_cursor: 'cursor-2', has_more: true },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: pageTwo,
          pagination: { next_cursor: null, has_more: false },
        }),
      });

    const result = await fetchAllProductsForDropdown('active');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call must carry the cursor returned by the first page.
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('cursor=cursor-2');

    expect(result).toHaveLength(101);
    expect(result.map((p) => p.id)).toContain('p-last');
  });

  it('stops after a single page when the API reports no more pages', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'only', name: 'Only Product' }],
        pagination: { next_cursor: null, has_more: false },
      }),
    });

    const result = await fetchAllProductsForDropdown('active');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });
});
