/**
 * fetchCouponsPage Unit Tests
 *
 * The coupons page used to request every coupon via `api.listAll` (sequential
 * requests, 100/page, 5000-item safety ceiling). A busy shop can have
 * thousands of coupons (the OTO system auto-generates one per qualifying
 * purchase), so a single page load meant dozens of round trips and a
 * silently incomplete list past the ceiling. This module backs the page's
 * "Load more" control: it fetches one page at a time and reports whether
 * another page is available, forwarding type/search/status filters to the
 * server so a match beyond the first page is still found.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchCouponsPage, COUPONS_PAGE_LIMIT } from '@/lib/coupons/fetch-coupons-page';

describe('fetchCouponsPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests a page at the API cap and reports has_more/next_cursor as-is', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` })),
        pagination: { next_cursor: 'cursor-2', has_more: true },
      }),
    });

    const page = await fetchCouponsPage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`limit=${COUPONS_PAGE_LIMIT}`);
    expect(url).not.toContain('cursor=');

    expect(page.coupons).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('cursor-2');
  });

  it('forwards the cursor to fetch the next page', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'last' }],
        pagination: { next_cursor: null, has_more: false },
      }),
    });

    const page = await fetchCouponsPage('cursor-2');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('cursor=cursor-2');
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('forwards a type filter as a query param', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage(undefined, { type: 'oto' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('type=oto');
  });

  it('omits the type param when type is "all"', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage(undefined, { type: 'all' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('type=');
  });

  it('forwards a search filter as a query param', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage(undefined, { search: 'SAVE20' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('search=SAVE20');
  });

  it('omits the search param when search is empty', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage(undefined, { search: '' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('search=');
  });

  it('forwards a status filter as a query param', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage(undefined, { status: 'expired' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('status=expired');
  });

  it('omits the status param when status is "all"', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage(undefined, { status: 'all' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('status=');
  });

  it('combines cursor, type, and search on the same request', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchCouponsPage('cursor-3', { type: 'regular', search: 'WELCOME' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('cursor=cursor-3');
    expect(url).toContain('type=regular');
    expect(url).toContain('search=WELCOME');
  });
});
