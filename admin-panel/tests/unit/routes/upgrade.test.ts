/** @see src/app/api/v1/system/upgrade/route.ts */
import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { dirname } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
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
import { POST } from '@/app/api/v1/system/upgrade/route';

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('upgrade unit PATH', () => {
  it('passes deduplicated server PATH plus running executable directory as one argument', async () => {
    vi.stubEnv('PATH', '/usr/bin:/root/.bun/bin:/usr/bin');
    expect((await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }))).status).toBe(202);
    const paths = [...new Set(['/usr/bin', '/root/.bun/bin', dirname(process.execPath)])];
    expect(spawn).toHaveBeenCalledWith('systemd-run', expect.arrayContaining([`--setenv=PATH=${paths.join(':')}`]), expect.any(Object));
  });
  it.each(['relative:/usr/bin', '/usr/bin::/bin', '/usr/bin\n--setenv=EVIL=1', '/usr/bin\0evil', 'C:\\tools:/bin'])('rejects unsafe PATH %j before launching', async (value) => {
    // Native process.env truncates NULs on assignment; preserve crafted input.
    vi.stubGlobal('process', { ...process, env: { ...process.env, PATH: value } });
    expect((await POST(new NextRequest('http://localhost/api/v1/system/upgrade', { method: 'POST' }))).status).toBe(500);
    expect(spawn).not.toHaveBeenCalled();
  });
});
