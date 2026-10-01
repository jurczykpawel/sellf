/**
 * fetchPaymentTransactionsPage Unit Tests
 *
 * The payments dashboard used to request `limit: 500` in a single call and
 * render only what came back. The v1 API clamps `limit` to 100 regardless
 * of what is requested, so a seller with more than 100 transactions would
 * silently see only the first 100 with no way to see the rest. This module
 * backs the dashboard's "Load more" control: it fetches one page at a time
 * and reports whether another page is available, so the UI can page through
 * an unbounded transaction history instead of either truncating silently or
 * loading everything into the browser at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchPaymentTransactionsPage, PAYMENTS_PAGE_LIMIT, dateRangeToDateFrom } from '@/lib/payments/fetch-transactions-page';

describe('fetchPaymentTransactionsPage', () => {
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
        data: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` })),
        pagination: { next_cursor: 'cursor-2', has_more: true },
      }),
    });

    const page = await fetchPaymentTransactionsPage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`limit=${PAYMENTS_PAGE_LIMIT}`);
    expect(url).not.toContain('cursor=');

    expect(page.transactions).toHaveLength(100);
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

    const page = await fetchPaymentTransactionsPage('cursor-2');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('cursor=cursor-2');
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('forwards a status filter as a query param', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchPaymentTransactionsPage(undefined, { status: 'completed' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('status=completed');
  });

  it('omits the status param when status is "all"', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchPaymentTransactionsPage(undefined, { status: 'all' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('status=');
  });

  it('forwards a search filter as a query param', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchPaymentTransactionsPage(undefined, { search: 'buyer@example.com' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('search=buyer%40example.com');
  });

  it('omits the search param when search is empty', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchPaymentTransactionsPage(undefined, { search: '' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('search=');
  });

  it('combines cursor, status, and search on the same request', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await fetchPaymentTransactionsPage('cursor-3', { status: 'refunded', search: 'pi_123' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('cursor=cursor-3');
    expect(url).toContain('status=refunded');
    expect(url).toContain('search=pi_123');
  });

  describe('dateRange -> date_from', () => {
    for (const range of ['7', '30', '90', '365']) {
      it(`forwards a computed date_from for the "${range}" day range`, async () => {
        const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
        });

        await fetchPaymentTransactionsPage(undefined, { dateRange: range });

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('date_from=');
      });
    }

    it('omits date_from for the "all" range', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
      });

      await fetchPaymentTransactionsPage(undefined, { dateRange: 'all' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).not.toContain('date_from=');
    });

    it('omits date_from when dateRange is not provided', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [], pagination: { next_cursor: null, has_more: false } }),
      });

      await fetchPaymentTransactionsPage(undefined, {});

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).not.toContain('date_from=');
    });
  });

  describe('dateRangeToDateFrom', () => {
    it('computes "now minus N days" for a known range, as an ISO string', () => {
      const now = new Date('2026-06-15T12:00:00.000Z');
      const result = dateRangeToDateFrom('7', now);
      expect(result).toBe('2026-06-08T12:00:00.000Z');
    });

    it('returns undefined for "all"', () => {
      expect(dateRangeToDateFrom('all', new Date())).toBeUndefined();
    });

    it('returns undefined for an unrecognized value', () => {
      expect(dateRangeToDateFrom('not-a-range', new Date())).toBeUndefined();
    });

    it('returns undefined when not provided', () => {
      expect(dateRangeToDateFrom(undefined, new Date())).toBeUndefined();
    });
  });
});
