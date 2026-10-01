import { NextRequest } from 'next/server';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  openSync: vi.fn(), closeSync: vi.fn(), fstatSync: vi.fn(), readFileSync: vi.fn(),
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
}));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/system/upgrade-paths', () => ({
  getUpgradeProgressFilePath: (token: string) => `/run/sellf/sellf-upgrade-${token}.json`,
}));

import { GET } from '@/app/api/v1/system/upgrade-status/route';

const token = '00000000-0000-0000-0000-000000000000';
const preferred = `/run/sellf/sellf-upgrade-${token}.json`;
const legacy = `/tmp/sellf-upgrade-${token}.json`;
const progress = { step: 'done', progress: 100, message: 'Completed' };
const missing = () => { throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); };
const request = () => new NextRequest(`http://localhost/api/v1/system/upgrade-status?token=${token}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'getuid').mockReturnValue(1000);
  vi.mocked(fstatSync).mockReturnValue({ isFile: () => true, uid: 1000 } as ReturnType<typeof fstatSync>);
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(progress));
});
afterEach(() => vi.restoreAllMocks());

describe('upgrade status progress locations', () => {
  it('returns legacy progress when preferred is missing and owner matches', async () => {
    vi.mocked(openSync).mockImplementation((path) => path === preferred ? missing() : 7);
    const response = await GET(request());
    expect((await response.json()).data).toEqual(progress);
    expect(openSync).toHaveBeenCalledWith(legacy, constants.O_RDONLY | constants.O_NOFOLLOW);
    expect(closeSync).toHaveBeenCalledWith(7);
  });

  it('treats a legacy file owned by another uid as pending', async () => {
    vi.mocked(openSync).mockImplementation((path) => path === preferred ? missing() : 7);
    vi.mocked(fstatSync).mockReturnValue({ isFile: () => true, uid: 2000 } as ReturnType<typeof fstatSync>);
    expect((await (await GET(request())).json()).data.step).toBe('pending');
    expect(readFileSync).not.toHaveBeenCalled();
    expect(closeSync).toHaveBeenCalledWith(7);
  });

  it('prefers the preferred file when both locations exist', async () => {
    vi.mocked(openSync).mockReturnValue(8);
    expect((await (await GET(request())).json()).data).toEqual(progress);
    expect(openSync).toHaveBeenCalledTimes(1);
    expect(openSync).toHaveBeenCalledWith(preferred, constants.O_RDONLY | constants.O_NOFOLLOW);
  });

  it('treats a non-regular legacy file as pending', async () => {
    vi.mocked(openSync).mockImplementation((path) => path === preferred ? missing() : 7);
    vi.mocked(fstatSync).mockReturnValue({ isFile: () => false, uid: 1000 } as ReturnType<typeof fstatSync>);
    expect((await (await GET(request())).json()).data.step).toBe('pending');
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('treats a legacy symbolic link as pending', async () => {
    vi.mocked(openSync).mockImplementation((path) => {
      if (path === preferred) return missing();
      throw Object.assign(new Error('Link'), { code: 'ELOOP' });
    });
    expect((await (await GET(request())).json()).data.step).toBe('pending');
    expect(readFileSync).not.toHaveBeenCalled();
  });
});
