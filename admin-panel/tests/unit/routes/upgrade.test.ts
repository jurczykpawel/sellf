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
vi.mock('fs', () => ({ existsSync: vi.fn((p: string) => p.endsWith('upgrade.sh')), openSync: vi.fn(() => 3), closeSync: vi.fn(), readFileSync: vi.fn(() => { throw new Error('missing'); }) }));
vi.mock('@/lib/system/upgrade-lock', () => ({ isUpgradeLockHeld: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/api', () => ({
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
  API_SCOPES: { SYSTEM_WRITE: 'system:write' }, handleCorsPreFlight: vi.fn(),
  jsonResponse: (body: unknown, _: unknown, status: number) => Response.json(body, { status }),
  handleApiError: () => Response.json({ error: 'Invalid environment' }, { status: 500 }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: () => ({ from: () => ({ insert: vi.fn() }) }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/system/upgrade-paths', () => ({ getUpgradeLockFilePath: () => '/lock', getUpgradeLogFilePath: () => '/log', getUpgradeProgressFilePath: (token: string) => `/progress-${token}` }));
import { checkLatestUpdaterCompatibility } from '@/lib/system/updater-compatibility';
import { getUpgradeCapability } from '@/lib/system/upgrade-runtime-server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { isUpgradeLockHeld } from '@/lib/system/upgrade-lock';
import { readFileSync } from 'fs';
import { POST, _resetUpgradeLaunchGuardForTests } from '@/app/api/v1/system/upgrade/route';

beforeEach(() => { vi.clearAllMocks(); _resetUpgradeLaunchGuardForTests(); });
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
  it.each(['docker', 'compose', 'coolify', 'vercel', 'netlify', 'systemd', 'manual', 'pm2'] as const)('declines a manual %s runtime before launch', async runtime => {
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

const post = () => POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }));

describe('retrying an update', () => {
  afterEach(() => vi.useRealTimers());

  it('has no ten-minute limit: a later attempt starts once the previous one has ended', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 13, 27), toFake: ['Date'] });
    expect((await post()).status).toBe(202);
    vi.setSystemTime(Date.UTC(2026, 10, 12, 13, 27, 15));
    expect((await post()).status).toBe(202);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('ignores a double click within a few seconds of a launch', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 13, 27), toFake: ['Date'] });
    expect((await post()).status).toBe(202);
    vi.setSystemTime(Date.UTC(2026, 10, 12, 13, 27, 3));
    const second = await post();
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('UPGRADE_STARTING');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('ignores a second click while the first request is still checking the release', async () => {
    let release: (value: { version: number; min_updater_version: number; compatible: boolean }) => void = () => {};
    vi.mocked(checkLatestUpdaterCompatibility).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = post();
    const second = await post();
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('UPGRADE_STARTING');
    release({ version: 2, min_updater_version: 1, compatible: true });
    expect((await first).status).toBe(202);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('allows an immediate retry when the previous attempt already failed', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 13, 27), toFake: ['Date'] });
    expect((await post()).status).toBe(202);
    const token = vi.mocked(spawn).mock.calls[0][1].find((argument: string) => /^[0-9a-f-]{36}$/.test(argument));
    vi.mocked(readFileSync).mockImplementation(((path: string) => {
      if (path === `/progress-${token}`) return '{"step":"failed","progress":-1,"message":"GitHub refused"}';
      throw new Error('missing');
    }) as typeof readFileSync);
    vi.setSystemTime(Date.UTC(2026, 10, 12, 13, 27, 2));
    expect((await post()).status).toBe(202);
  });

  it('allows an immediate retry after a failed release check', async () => {
    vi.mocked(checkLatestUpdaterCompatibility).mockResolvedValueOnce({
      version: 2, compatible: false, reason: 'verification_failed', message: 'Could not verify',
      failure: { code: 'github_http', details: { http_status: 429, retry_at: '2026-11-12T14:27:00.000Z' } },
    });
    const failed = await post();
    expect(failed.status).toBe(409);
    expect((await failed.json()).error).toMatchObject({
      code: 'UPDATER_VERIFICATION_FAILED', failure: { code: 'github_http', details: { http_status: 429 } },
    });
    expect((await post()).status).toBe(202);
  });

  it('refuses while an update holds the instance lock', async () => {
    vi.mocked(isUpgradeLockHeld).mockResolvedValueOnce(true);
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('UPGRADE_RUNNING');
    expect(isUpgradeLockHeld).toHaveBeenCalledWith('/lock');
    expect(spawn).not.toHaveBeenCalled();
  });
});
