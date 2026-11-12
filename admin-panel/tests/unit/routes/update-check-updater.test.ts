/** Admin preflight and cached responses must never offer an incompatible update. */
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({ authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }), API_SCOPES: { SYSTEM_READ: 'system:read' }, handleCorsPreFlight: vi.fn(), handleApiError: vi.fn(), jsonResponse: (body: unknown) => Response.json(body) }));
vi.mock('@/lib/system/upgrade-runtime-server', () => ({ getUpgradeCapability: () => ({ runtime: 'pm2', mode: 'in-place' }) }));
vi.mock('@/lib/system/updater-compatibility', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/system/updater-compatibility')>(),
  refreshUpdaterCompatibility: vi.fn(updater => updater),
  getUpdaterCompatibility: vi.fn().mockResolvedValue({ version: 1, min_updater_version: 2, compatible: false, reason: 'too_old' }),
}));
import { GET } from '@/app/api/v1/system/update-check/route';
afterEach(() => vi.unstubAllGlobals());
it('returns a blocked capability and the minimum for both fresh and cached checks', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v2099.1.0' }) }));
  for (const query of ['?force=true', '']) {
    const response = await GET(new NextRequest('http://localhost/api/v1/system/update-check' + query));
    const data = (await response.json()).data;
    expect(data.upgrade).toEqual({ runtime: 'pm2', mode: 'manual' });
    expect(data.updater.min_updater_version).toBe(2);
    expect(data.updater.compatible).toBe(false);
    expect(data.update_available).toBe(true);
  }
});
