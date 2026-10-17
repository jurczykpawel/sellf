import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, createPublicClient } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), or: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn() };
  return { query, createPublicClient: vi.fn(() => ({ from: vi.fn(() => query) })) };
});
vi.mock('@/lib/supabase/server', () => ({ createPublicClient }));
import { getSitemapProducts, renderSitemap, renderSitemapIndex } from '@/lib/seo/sitemap';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SITE_URL', 'https://shop.example');
  for (const fn of Object.values(query)) fn.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null });
});

describe('bounded product sitemaps', () => {
  it('queries narrow columns with visibility, time, cursor and a fixed limit', async () => {
    await getSitemapProducts('00000000-0000-0000-0000-000000000000', new Date('2026-10-15T12:00:00Z'));
    expect(query.select).toHaveBeenCalledWith('id,slug,updated_at');
    expect(query.eq.mock.calls).toEqual([['is_active', true], ['is_listed', true]]);
    expect(query.or.mock.calls).toEqual([
      ['available_from.is.null,available_from.lte.2026-10-15T12:00:00.000Z'],
      ['available_until.is.null,available_until.gt.2026-10-15T12:00:00.000Z'],
    ]);
    expect(query.gt).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000000');
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(query.limit).toHaveBeenCalledWith(1000);
  });

  it('renders localized URLs, alternates and actual modification dates', () => {
    const xml = renderSitemap([{ id: 'a', slug: 'course', updated_at: '2026-10-01T00:00:00Z' }], true);
    expect(xml).toContain('<loc>https://shop.example/p/course</loc>');
    expect(xml).toContain('<loc>https://shop.example/pl/p/course</loc>');
    expect(xml).toContain('hreflang="en" href="https://shop.example/p/course"');
    expect(xml).toContain('<lastmod>2026-10-01T00:00:00Z</lastmod>');
    expect(xml).toContain('<loc>https://shop.example/store</loc>');
    expect(xml).not.toContain('/en/');
    expect(renderSitemap([], false)).not.toContain('/store');
  });

  it('enumerates every chunk without an exact count or offset', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, slug: `p-${i}`, updated_at: '' }));
    query.limit.mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'last', slug: 'last', updated_at: '' }], error: null });
    const xml = await renderSitemapIndex();
    expect(xml).toContain('/sitemaps/00000000-0000-0000-0000-000000000000.xml');
    expect(xml).toContain('/sitemaps/id-999.xml');
    expect(query.gt.mock.calls[1]).toEqual(['id', 'id-999']);
    expect(query.limit).toHaveBeenCalledTimes(2);
  });

  it('does not publish an incomplete index after a query error', async () => {
    query.limit.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await expect(renderSitemapIndex()).rejects.toThrow('Could not load sitemap products');
  });
});

describe('sitemap routes', () => {
  it('returns XML for the index and validates chunk cursors before reading products', async () => {
    const { GET: index } = await import('@/app/sitemap.xml/route');
    const { GET: chunk } = await import('@/app/sitemaps/[cursor]/route');
    expect((await index()).headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    vi.clearAllMocks();
    const response = await chunk(new Request('https://shop.example/sitemaps/no.xml'), {
      params: Promise.resolve({ cursor: 'no.xml' }),
    });
    expect(response.status).toBe(404);
    expect(createPublicClient).not.toHaveBeenCalled();
    const valid = await chunk(new Request('https://shop.example/sitemaps/00000000-0000-0000-0000-000000000000.xml'), {
      params: Promise.resolve({ cursor: '00000000-0000-0000-0000-000000000000.xml' }),
    });
    expect(valid.status).toBe(200);
    expect(await valid.text()).toContain('https://shop.example/store');
  });
});
