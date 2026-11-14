/** An update counts as running only while a process holds the updater's lock. @see src/lib/system/upgrade-lock.ts */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));
import { isUpgradeLockHeld } from '@/lib/system/upgrade-lock';

function probeExits(result: number | Error) {
  vi.mocked(spawn).mockImplementationOnce(() => ({
    once: (event: string, callback: (value: unknown) => void) => {
      if (event === 'error' && result instanceof Error) callback(result);
      if (event === 'exit' && typeof result === 'number') callback(result);
    },
  }) as unknown as ReturnType<typeof spawn>);
}

beforeEach(() => vi.clearAllMocks());

describe('isUpgradeLockHeld', () => {
  it('is free without a lock file', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    expect(await isUpgradeLockHeld('/run/sellf/sellf-upgrade-sellf-tsa.lock')).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('is free when a lock file is left behind but nobody holds it', async () => {
    probeExits(0);
    expect(await isUpgradeLockHeld('/run/sellf/sellf-upgrade-sellf-tsa.lock')).toBe(false);
    expect(spawn).toHaveBeenCalledWith('flock', ['-n', '-E', '75', '/run/sellf/sellf-upgrade-sellf-tsa.lock', 'true'], expect.objectContaining({ stdio: 'ignore' }));
  });

  it('is held when the updater holds the lock', async () => {
    probeExits(75);
    expect(await isUpgradeLockHeld('/run/sellf/sellf-upgrade-sellf-tsa.lock')).toBe(true);
  });

  it.each([1, new Error('spawn flock ENOENT')])('counts an unclear probe result (%s) as held', async result => {
    probeExits(result);
    expect(await isUpgradeLockHeld('/run/sellf/sellf-upgrade-sellf-tsa.lock')).toBe(true);
  });
});
