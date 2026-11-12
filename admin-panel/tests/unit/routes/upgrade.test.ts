/** @see src/app/api/v1/system/upgrade/route.ts */
import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { dirname } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/system/updater-compatibility', () => ({ checkLatestUpdaterCompatibility: vi.fn().mockResolvedValue({ version: 2, min_updater_version: 1, compatible: true }) }));
vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ once: vi.fn((event, callback) => { if (event === 'exit') callback(0); }) })) }));
vi.mock('@/lib/system/upgrade-runtime-server', () => ({
  getUpgradeCapability: vi.fn(() => ({ runtime: 'pm2', mode: 'in-place' })),
  findUpgradeScript: () => '/install/scripts/upgrade.sh', getUpgradeInstallDir: () => '/install/admin-panel',
}));
vi.mock('fs', () => ({ existsSync: vi.fn((p: string) => p.endsWith('upgrade.sh')), openSync: vi.fn(() => 3), closeSync: vi.fn() }));
vi.mock('@/lib/api', () => ({
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
  API_SCOPES: { SYSTEM_WRITE: 'system:write' }, handleCorsPreFlight: vi.fn(),
  jsonResponse: (body: unknown, _: unknown, status: number) => Response.json(body, { status }),
  handleApiError: () => Response.json({ error: 'Invalid environment' }, { status: 500 }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: () => ({ from: () => ({ insert: vi.fn() }) }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/system/upgrade-paths', () => ({ getUpgradeLockFilePath: () => '/lock', getUpgradeLogFilePath: () => '/log' }));
import { checkLatestUpdaterCompatibility } from '@/lib/system/updater-compatibility';
import { getUpgradeCapability } from '@/lib/system/upgrade-runtime-server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { POST } from '@/app/api/v1/system/upgrade/route';

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('upgrade unit PATH', () => {
  it('passes deduplicated server PATH plus running executable directory as one argument', async () => {
    vi.stubEnv('PATH', '/usr/bin:/root/.bun/bin:/usr/bin');
    expect((await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }))).status).toBe(202);
    const paths = [...new Set(['/usr/bin', '/root/.bun/bin', dirname(process.execPath)])];
    expect(spawn).toHaveBeenCalledWith('/usr/bin/systemd-run', expect.arrayContaining([`--setenv=PATH=${paths.join(':')}`]), expect.any(Object));
  });
  it.each([
    ['/usr/bin:', ['/usr/bin'], 1],
    ['/usr/bin:.:/bin', ['/usr/bin', '/bin'], 1],
    ['relative:/usr/bin', ['/usr/bin'], 1],
    ['/usr/bin:/bad\nentry:/bin', ['/usr/bin', '/bin'], 1],
    ['/usr/bin::/bin', ['/usr/bin', '/bin'], 1],
    ['/usr/bin:/bad\0entry', ['/usr/bin'], 1],
    ['C:\\tools:/bin', ['/bin'], 2],
    ['.:relative:', [], 3],
  ])('drops unusable entries from PATH %j and proceeds without logging their values', async (value, validEntries, droppedCount) => {
    // Native process.env truncates NULs on assignment; preserve crafted input.
    vi.stubGlobal('process', { ...process, env: { ...process.env, PATH: value } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }))).status).toBe(202);
    const paths = [...new Set([...validEntries, dirname(process.execPath)])];
    expect(spawn).toHaveBeenCalledWith('/usr/bin/systemd-run', expect.arrayContaining([`--setenv=PATH=${paths.join(':')}`]), expect.any(Object));
    expect(warn.mock.calls).toEqual([[`[system/upgrade] Skipped ${droppedCount} unusable PATH entries`]]);
  });
});


describe('upgrade runtime API', () => {
  it.each(['docker', 'compose', 'coolify', 'vercel', 'netlify', 'systemd', 'manual', 'pm2'] as const)('declines a manual %s runtime before rate limit or launch', async runtime => {
    vi.mocked(getUpgradeCapability).mockReturnValueOnce({ runtime, mode: 'manual' });
    const response = await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('MANUAL_UPGRADE_REQUIRED');
    expect(spawn).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
  it('reports a launcher failure instead of accepting the upgrade', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => ({ once: (event: string, callback: (code: number) => void) => { if (event === 'exit') callback(1); } }) as ReturnType<typeof spawn>);
    expect((await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }))).status).toBe(500);
  });
});

describe('signed updater preflight', () => {
  it.each(['too_old', 'verification_failed'] as const)('rejects %s before file creation or launcher', async reason => {
    vi.mocked(checkLatestUpdaterCompatibility).mockResolvedValueOnce({ version: 1, min_updater_version: 2, compatible: false, reason, message: 'Use Stackpilot' });
    const response = await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: reason === 'too_old' ? 'UPDATER_TOO_OLD' : 'UPDATER_VERIFICATION_FAILED', message: 'Use Stackpilot' });
    expect(spawn).not.toHaveBeenCalled();
  });
});
