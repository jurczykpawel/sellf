/** The admin update check finds the latest release without api.github.com and explains failures. @see src/app/api/v1/system/update-check/route.ts */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
  API_SCOPES: { SYSTEM_READ: 'system:read' }, handleCorsPreFlight: vi.fn(), handleApiError: vi.fn(),
  jsonResponse: (body: unknown) => Response.json(body),
}));
vi.mock('@/lib/version', () => ({
  APP_VERSION: '2026.11.1',
  isNewerVersion: (current: string, latest: string) => latest.localeCompare(current, undefined, { numeric: true }) > 0,
}));
import { GET } from '@/app/api/v1/system/update-check/route';

const get = async () => (await (await GET(new NextRequest('http://localhost/api/v1/system/update-check?force=true'))).json()).data;
const latestRedirect = () => new Response(null, { status: 302, headers: { location: 'https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2' } });

beforeEach(() => vi.stubEnv('SELLF_DEPLOYMENT_RUNTIME', 'manual'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('update check without api.github.com', () => {
  it('does not offer rc returned from latest to a stable installation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2-rc.1' } })));
    expect(await get()).toMatchObject({ update_available: false, check_error: { code: 'release_lookup_invalid' } });
  });

  it('takes the latest version from the github.com redirect even when the API is rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === 'https://github.com/jurczykpawel/sellf/releases/latest'
      ? latestRedirect()
      : new Response('{"message":"API rate limit exceeded"}', { status: 403 })));
    const data = await get();
    expect(data).toMatchObject({
      latest_version: '2026.11.2', update_available: true,
      release_url: 'https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2', release_notes: null,
    });
    expect(data.check_error).toBeUndefined();
  });

  it('adds release notes when GitHub provides them, without depending on them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/releases/latest')
      ? latestRedirect()
      : Response.json({ tag_name: 'v2026.11.2', body: 'Fixes', published_at: '2026-11-14T10:00:00Z' })));
    expect(await get()).toMatchObject({ latest_version: '2026.11.2', release_notes: 'Fixes', published_at: '2026-11-14T10:00:00Z' });
  });

  it('ignores release notes that belong to another tag', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/releases/latest')
      ? latestRedirect()
      : Response.json({ tag_name: 'v2026.11.1', body: 'Old notes' })));
    expect((await get()).release_notes).toBeNull();
  });

  it('reports why the check failed instead of claiming the shop is up to date', async () => {
    const reset = Math.floor(Date.UTC(2026, 10, 12, 14, 27) / 1000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Too many requests"}', {
      status: 429, headers: { 'content-type': 'application/json', 'x-ratelimit-reset': String(reset) },
    })));
    expect(await get()).toMatchObject({
      latest_version: '2026.11.1', update_available: false,
      check_error: { code: 'github_http', details: { http_status: 429, github_message: 'Too many requests', retry_at: '2026-11-12T14:27:00.000Z' } },
    });
  });

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect((await get()).check_error).toEqual({ code: 'github_unreachable', details: {} });
  });
});
