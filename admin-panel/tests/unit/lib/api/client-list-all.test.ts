/**
 * api.listAll Unit Tests
 *
 * The v1 API clamps `limit` to MAX_LIMIT (100) regardless of what a caller
 * requests, and reports `has_more` / `next_cursor` so a caller can walk the
 * rest of the pages. Several admin screens used to request a single page
 * with a `limit` far above 100 and take only that page, silently dropping
 * rows once a seller's data grew past 100 items. `api.listAll` centralizes
 * "follow the cursor until done" so every such screen shares one correct,
 * bounded implementation instead of re-implementing (or forgetting) the
 * loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { api } from '@/lib/api/client';

interface Item {
  id: string;
  name: string;
}

function mockPage(data: Item[], nextCursor: string | null, hasMore: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data,
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    }),
  };
}

describe('api.listAll', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stops after a single page when the API reports no more pages', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockPage([{ id: 'only', name: 'Only Item' }], null, false)
    );

    const result = await api.listAll<Item>('widgets', { limit: 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('follows next_cursor across multiple pages until has_more is false', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `Item ${i}` }));
    const pageTwo = Array.from({ length: 100 }, (_, i) => ({ id: `q${i}`, name: `Item ${100 + i}` }));
    const pageThree = [{ id: 'last', name: 'Last Item' }];

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockPage(pageOne, 'cursor-2', true))
      .mockResolvedValueOnce(mockPage(pageTwo, 'cursor-3', true))
      .mockResolvedValueOnce(mockPage(pageThree, null, false));

    const result = await api.listAll<Item>('widgets');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    const thirdCallUrl = fetchMock.mock.calls[2][0] as string;
    expect(secondCallUrl).toContain('cursor=cursor-2');
    expect(thirdCallUrl).toContain('cursor=cursor-3');

    expect(result.data).toHaveLength(201);
    expect(result.data.map((item) => item.id)).toContain('last');
    expect(result.truncated).toBe(false);
  });

  it('reports truncation and stops once the safety ceiling is hit, instead of looping forever', async () => {
    const makePage = (n: number) =>
      Array.from({ length: 100 }, (_, i) => ({ id: `page${n}-${i}`, name: `Item ${n}-${i}` }));

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    // Every page reports has_more: true with a fresh cursor — an unbounded
    // (or adversarial) dataset. Without a ceiling this would loop forever.
    fetchMock.mockImplementation(async (url: string) => {
      const match = /page=(\d+)/.exec(url);
      const pageNum = match ? parseInt(match[1], 10) : 0;
      return mockPage(makePage(pageNum), `cursor-${pageNum + 1}&page=${pageNum + 1}`, true);
    });

    const result = await api.listAll<Item>('widgets', {}, { maxItems: 250 });

    // 3 pages of 100 = 300 items fetched before the 250 ceiling is checked
    // after each page; the loop must stop, not run away.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(result.data.length).toBeGreaterThanOrEqual(250);
    expect(result.truncated).toBe(true);
  });

  it('passes through filter params on every page request', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        mockPage([{ id: 'a', name: 'A' }], 'cursor-2', true)
      )
      .mockResolvedValueOnce(mockPage([{ id: 'b', name: 'B' }], null, false));

    await api.listAll<Item>('widgets', { status: 'active', sort_by: 'name' });

    const firstCallUrl = fetchMock.mock.calls[0][0] as string;
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(firstCallUrl).toContain('status=active');
    expect(secondCallUrl).toContain('status=active');
    expect(secondCallUrl).toContain('cursor=cursor-2');
  });
});
