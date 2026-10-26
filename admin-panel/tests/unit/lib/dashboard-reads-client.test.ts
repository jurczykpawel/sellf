/** Dashboard read client: request shape, abort propagation, and which failures count as expected. */
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, isExpectedApiError } from '@/lib/api/client';
import { readDashboard } from '@/lib/api/dashboard-reads';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

it('GETs /api/admin/dashboard with the read and its parameters, skipping empty ones', async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(200, { data: [1] }));
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  await expect(readDashboard('chart', { days: 30, productId: undefined }, controller.signal)).resolves.toEqual([1]);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/admin/dashboard?read=chart&days=30');
  expect(options.signal).toBe(controller.signal);
});

it('rejects with an AbortError once the signal is aborted, which is expected', async () => {
  vi.stubGlobal('fetch', (_url: string, { signal }: RequestInit) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const controller = new AbortController();
  const pending = readDashboard('products', {}, controller.signal);
  controller.abort();
  const error = await pending.catch(e => e);
  expect(isExpectedApiError(error)).toBe(true);
});

it('keeps a server error visible as an ApiError with its status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(500, { error: { code: 'INTERNAL_ERROR', message: 'Failed to read dashboard data' } })));
  const error = await readDashboard('chart').catch(e => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  expect(isExpectedApiError(error)).toBe(false);
});
