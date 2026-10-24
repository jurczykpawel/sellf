/**
 * Admin API session recovery contract.
 * @see src/lib/api/client.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';

const { refreshSession } = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ auth: { refreshSession } }) }));
const unauthorized = () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }), { status: 401 });

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn());
  refreshSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'admin' } } }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

const operations = [
  () => api.list('products'), () => api.get('products', 'id'),
  () => api.getCustom('analytics/dashboard'), () => api.create('products', { name: 'Name' }),
  () => api.postCustom('webhooks/id/test'), () => api.update('products', 'id', { name: 'Name' }),
  () => api.putCustom('settings', { enabled: true }), () => api.delete('webhooks', 'id'),
  () => api.deleteCustom('webhooks/id'),
];

describe('admin session recovery', () => {
  it.each(operations.map((operation, index) => [index, operation] as const))('retries operation %s once with the same request after refresh', async (_, operation) => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    await operation();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(refreshSession.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[1]);
  });

  it('reports persistent 401 through the shared expiry event and a readable error', async () => {
    const expired = vi.fn();
    window.addEventListener('sellf:session-expired', expired);
    vi.mocked(fetch).mockImplementation(async () => unauthorized());
    await expect(api.delete('webhooks', 'id')).rejects.toMatchObject({ code: 'SESSION_EXPIRED', status: 401, message: 'Session expired — sign in again' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight refresh between concurrent requests', async () => {
    let finish!: (value: unknown) => void;
    refreshSession.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(fetch).mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized())
      .mockImplementation(async () => new Response(JSON.stringify({ data: [] })));
    const requests = Promise.all([api.list('products'), api.list('webhooks')]);
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    finish({ data: { session: {} }, error: null });
    await requests;
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('reports expiry when refresh fails without repeating a mutation', async () => {
    refreshSession.mockRejectedValue(new Error('refresh unavailable'));
    vi.mocked(fetch).mockResolvedValueOnce(unauthorized());
    await expect(api.delete('webhooks', 'id')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves AbortError without refresh or logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new DOMException('Navigation cancelled', 'AbortError');
    vi.mocked(fetch).mockRejectedValueOnce(error);
    await expect(api.list('products')).rejects.toBe(error);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('does not refresh or retry a forbidden request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(api.delete('webhooks', 'id')).rejects.toMatchObject({ status: 403 });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
