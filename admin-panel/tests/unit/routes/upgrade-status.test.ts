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

describe('upgrade status failure reason', () => {
  it('passes a validated code and bounded details through to the panel', async () => {
    vi.mocked(openSync).mockReturnValue(7);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      step: 'failed', progress: -1, rollback: false, message: 'x'.repeat(1500),
      code: 'github_http',
      details: {
        http_status: 429, github_message: 'API rate limit exceeded', retry_at: '2026-11-12T14:27:00Z',
        installed_version: '2026.11.0', asset: 'sellf-build.tar.gz', unexpected: 'dropped',
      },
    }));
    const data = (await (await GET(request())).json()).data;
    expect(data.message).toHaveLength(1500);
    expect(data.code).toBe('github_http');
    expect(data.details).toEqual({
      http_status: 429, github_message: 'API rate limit exceeded', retry_at: '2026-11-12T14:27:00Z',
      installed_version: '2026.11.0', asset: 'sellf-build.tar.gz',
    });
  });

  it('redacts secrets and removes markup and control characters from message, cause and GitHub message', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'FAKE_SERVICE_KEY_w251rb_only');
    const dirty = 'FAKE_SERVICE_KEY_w251rb_only ' + ['sk', 'live', '51FakeFakeFakeFakeFake'].join('_') + ' <img src=x onerror=alert(1)> \u0001\u007f\u0085\u202e end';
    vi.mocked(openSync).mockReturnValue(7);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      step: 'failed', progress: -1, message: dirty, code: 'migration_state_unknown', details: { cause: dirty, github_message: dirty },
    }));
    const data = (await (await GET(request())).json()).data;
    for (const value of [data.message, data.details.cause, data.details.github_message]) {
      expect(value).toBe('[redacted] [redacted]   end');
    }
    vi.unstubAllEnvs();
  });

  it.each(['pm2_stop_failed', 'pm2_stop_failed_offline', 'migration_state_unknown'])('passes the localized code %s through to the panel', async code => {
    vi.mocked(openSync).mockReturnValue(7);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ step: 'failed', progress: -1, message: 'm', code, details: { installed_version: '2026.11.0', cause: 'c' } }));
    const data = (await (await GET(request())).json()).data;
    expect({ code: data.code, details: data.details }).toEqual({ code, details: { installed_version: '2026.11.0', cause: 'c' } });
  });

  it('redacts a value after a colon, in a URL path, in a file path and before a dot in every text field', async () => {
    const T = 'QmFzZTY0RmFrZVNlY3JldFZhbHVlRm9yVGVzdHM9PQ==';
    const dirty = `apikey:${T} https://example.com/${T} /tmp/${T} ${T}. ${T}.json`;
    vi.mocked(openSync).mockReturnValue(7);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ step: 'failed', progress: -1, message: dirty, code: 'migration_failed', details: { cause: dirty, github_message: dirty } }));
    const data = (await (await GET(request())).json()).data;
    for (const value of [data.message, data.details.cause, data.details.github_message]) {
      expect(value).not.toContain('QmFzZTY0');
      expect(value).toBe('apikey:[redacted] https://example.com/[redacted] /tmp/[redacted] [redacted]. [redacted].json');
    }
  });

  it('rejects codes outside the controlled format', async () => {
    for (const code of ['2fa', 'Upper', 'a-b', 'x'.repeat(41), '_lead']) {
      vi.mocked(openSync).mockReturnValue(7);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ step: 'failed', progress: -1, message: 'm', code }));
      expect((await (await GET(request())).json()).data.code, code).toBeUndefined();
    }
  });

  it.each([
    [{ code: 'Bad Code!', details: { http_status: 429 } }, {}],
    [{ code: 'github_http', details: { http_status: '429', asset: '../x', retry_at: 'soon', github_message: 7, migration: 'x; drop', installed_version: 'latest' } }, { code: 'github_http', details: {} }],
    [{ code: 'migration_failed', details: { cause: 'c'.repeat(400), migration: '20261114110001_alpha' } }, { code: 'migration_failed', details: { cause: 'c'.repeat(300), migration: '20261114110001_alpha' } }],
  ])('drops invalid failure fields %#', async (raw, expected) => {
    vi.mocked(openSync).mockReturnValue(7);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ step: 'failed', progress: -1, message: 'm', ...raw }));
    const data = (await (await GET(request())).json()).data;
    expect({ code: data.code, details: data.details }).toEqual({ code: undefined, details: undefined, ...expected });
  });
});
