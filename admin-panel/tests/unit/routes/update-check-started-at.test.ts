/** Process identity stays private to the authenticated system route. @see src/app/api/v1/system/update-check/route.ts */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
  API_SCOPES: { SYSTEM_READ: 'system:read' }, handleCorsPreFlight: vi.fn(), handleApiError: vi.fn(),
  jsonResponse: (body: unknown) => Response.json(body),
}));
import { GET } from '@/app/api/v1/system/update-check/route';
afterEach(() => vi.unstubAllGlobals());
describe('admin update-check process identity', () => {
  it('returns a stable ISO process start time on upstream failure, success and cached results', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v2026.10.1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const get = async (force: boolean) => (await (await GET(new NextRequest(`http://localhost/api/v1/system/update-check${force ? '?force=true' : ''}`))).json()).data;
    const failed = await get(true);
    const success = await get(true);
    const cached = await get(false);
    expect(failed.started_at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(Number.isFinite(Date.parse(failed.started_at))).toBe(true);
    expect(success.started_at).toBe(failed.started_at);
    expect(cached.started_at).toBe(failed.started_at);
  });
});
