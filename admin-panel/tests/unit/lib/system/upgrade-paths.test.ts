import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'fs';

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  mkdirSync: vi.fn(),
}));

describe('upgrade-paths', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The test runner isn't root — force process.getuid() to report a chosen uid. */
  function mockUid(uid: number) {
    vi.spyOn(process, 'getuid' as never).mockReturnValue(uid as never);
  }

  it('prefers /run/sellf and creates it 0700 when running as root and writable', async () => {
    mockUid(0);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    const { getUpgradeRuntimeDir } = await import('@/lib/system/upgrade-paths');

    expect(getUpgradeRuntimeDir()).toBe('/run/sellf');
    expect(mkdirSync).toHaveBeenCalledWith('/run/sellf', { recursive: true, mode: 0o700 });
  });

  it('falls back to /tmp when /run/sellf cannot be created even as root', async () => {
    mockUid(0);
    vi.mocked(mkdirSync).mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    const { getUpgradeRuntimeDir } = await import('@/lib/system/upgrade-paths');

    expect(getUpgradeRuntimeDir()).toBe('/tmp');
  });

  it('falls back to /tmp when not running as root, without ever attempting /run/sellf', async () => {
    mockUid(1000);
    vi.mocked(mkdirSync).mockReturnValue(undefined); // would succeed if it were ever called
    const { getUpgradeRuntimeDir } = await import('@/lib/system/upgrade-paths');

    expect(getUpgradeRuntimeDir()).toBe('/tmp');
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('memoizes the resolved directory across calls (does not re-check the filesystem every time)', async () => {
    mockUid(0);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    const { getUpgradeRuntimeDir } = await import('@/lib/system/upgrade-paths');

    getUpgradeRuntimeDir();
    getUpgradeRuntimeDir();
    getUpgradeRuntimeDir();

    expect(mkdirSync).toHaveBeenCalledTimes(1);
  });

  it('builds progress/log/lock paths under the resolved runtime dir with the legacy filename prefix', async () => {
    mockUid(0);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    const { getUpgradeProgressFilePath, getUpgradeLogFilePath, getUpgradeLockFilePath } =
      await import('@/lib/system/upgrade-paths');

    expect(getUpgradeProgressFilePath('abc-123')).toBe('/run/sellf/sellf-upgrade-abc-123.json');
    expect(getUpgradeLogFilePath('abc-123')).toBe('/run/sellf/sellf-upgrade-abc-123.log');
    expect(getUpgradeLockFilePath('sellf-tsa')).toBe('/run/sellf/sellf-upgrade-sellf-tsa.lock');
  });
});
