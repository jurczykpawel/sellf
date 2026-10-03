/** Process identity stays private to the authenticated system route. @see src/app/api/v1/system/update-check/route.ts */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
  API_SCOPES: { SYSTEM_READ: 'system:read' }, handleCorsPreFlight: vi.fn(), handleApiError: vi.fn(),
  jsonResponse: (body: unknown) => Response.json(body),
}));
import { GET } from '@/app/api/v1/system/update-check/route';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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


describe('deployment update metadata', () => {
  it.each(['docker', 'compose', 'coolify', 'vercel', 'netlify', 'systemd', 'manual', 'pm2'])('returns %s capability even when upstream is unavailable', async runtime => {
    vi.stubEnv('SELLF_DEPLOYMENT_RUNTIME', runtime);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const response = await GET(new NextRequest('http://localhost/api/v1/system/update-check?force=true'));
    expect((await response.json()).data.upgrade).toEqual({ runtime, mode: 'manual' });
  });
  it('reads metadata from a configured fixture URL without changing release URL validation', async () => {
    vi.stubEnv('SELLF_UPDATE_CHECK_URL', 'http://localhost:55330/latest');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v2099.1.0', html_url: 'http://localhost/release' }) });
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new NextRequest('http://localhost/api/v1/system/update-check?force=true'));
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:55330/latest', expect.objectContaining({ redirect: 'error' }));
    const data = (await response.json()).data;
    expect(data.update_available).toBe(true);
    expect(data.release_url).toBeNull();
  });
});
