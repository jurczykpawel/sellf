/** Public catalogue request boundary. @see app/api/storefront/catalogue/route.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/storefront/catalogue/route';
import { checkRateLimit } from '@/lib/rate-limiting';
import { loadCataloguePage } from '@/lib/storefront-templates/catalogue';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadCataloguePage: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
const input = {
  locale: 'en',
  search: '',
  categoryIds: [],
  priceKind: null,
  format: null,
  group: 'all',
  cursor: null,
  pageSize: 9,
};
const request = (value: unknown = input) =>
  new NextRequest(`http://localhost/api/storefront/catalogue?input=${encodeURIComponent(JSON.stringify(value))}`);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(loadCataloguePage).mockResolvedValue({ success: true, data: { products: [], nextCursor: null } });
});
it('rate limits before creating the public read client', async () => {
  vi.mocked(checkRateLimit).mockResolvedValue(false);
  expect((await GET(request())).status).toBe(429);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(loadCataloguePage).not.toHaveBeenCalled();
});
it.each([
  { ...input, pageSize: 100000 },
  { ...input, categoryIds: Array(13).fill('55555555-5555-4555-8555-555555555555') },
  { ...input, search: 'a'.repeat(101) },
  { ...input, actor: 'caller' },
  { ...input, cursor: 'wrong!' },
])('rejects invalid request before reading', async (value) => {
  expect((await GET(request(value))).status).toBe(422);
  expect(createAdminClient).not.toHaveBeenCalled();
});
it('rejects absent, malformed and oversized inputs', async () => {
  for (const suffix of ['', '?input=%7B', `?input=${'a'.repeat(4097)}`])
    expect((await GET(new NextRequest(`http://localhost/api/storefront/catalogue${suffix}`))).status).toBe(422);
  expect(createAdminClient).not.toHaveBeenCalled();
});
it.each(['INVALID', 'UNAVAILABLE'] as const)('maps loader %s to a bounded generic response', async (error) => {
  vi.mocked(loadCataloguePage).mockResolvedValue({ success: false, error });
  const result = await GET(request());
  expect(result.status).toBe(error === 'INVALID' ? 422 : 503);
  expect(await result.json()).toEqual({ error });
  expect(result.headers.get('Cache-Control')).toBe('no-store');
});
it('returns only the bounded public loader page and normalized filters', async () => {
  const result = await GET(request({ ...input, search: '  Cafe\u0301  ' }));
  expect(await result.json()).toEqual({ products: [], nextCursor: null });
  expect(vi.mocked(loadCataloguePage).mock.calls[0][1]).toMatchObject({ search: 'Café', pageSize: 9 });
  expect(checkRateLimit).toHaveBeenCalledWith('storefront_catalogue', 60, 1);
});
it('handles read initialization failures without exposing their content', async () => {
  vi.mocked(createAdminClient).mockImplementationOnce(() => {
    throw new Error('internal settings');
  });
  const result = await GET(request());
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain('internal');
});
