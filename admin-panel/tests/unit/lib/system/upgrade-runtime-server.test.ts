/** @see src/lib/system/upgrade-runtime-server.ts */
import { execFileSync } from 'child_process';
import { existsSync, accessSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('fs', () => ({ constants: { X_OK: 1, W_OK: 2 }, existsSync: vi.fn(), accessSync: vi.fn() }));
import { getUpgradeCapability } from '@/lib/system/upgrade-runtime-server';
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ name: 'sellf-matrix', pm2_env: { exec_mode: 'fork_mode', pm_cwd: '/opt/stacks/sellf-matrix/admin-panel/.next/standalone/admin-panel' } }]));
  vi.stubGlobal('process', { ...process, platform: 'linux', cwd: () => '/opt/stacks/sellf-matrix/admin-panel/.next/standalone/admin-panel', getuid: () => 0, env: { pm_id: '0', PATH: '/usr/bin' } });
  vi.mocked(existsSync).mockImplementation(file => !['/.dockerenv', '/run/.containerenv'].includes(String(file)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('installed upgrade preflight', () => {
  it('confirms the instance PM2 process in the expected daemon', () => {
    expect(getUpgradeCapability()).toEqual({ runtime: 'pm2', mode: 'in-place' });
    expect(execFileSync).toHaveBeenCalledWith('/usr/bin/pm2', ['jlist'], expect.objectContaining({ timeout: 3000, env: expect.objectContaining({ HOME: '/root', PM2_HOME: '/root/.pm2' }) }));
  });
  it('uses manual instructions when the named PM2 process is absent', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('Not found'); });
    expect(getUpgradeCapability().mode).toBe('manual');
  });
  it('requires a writable installation', () => {
    vi.mocked(accessSync).mockImplementationOnce(() => { throw new Error('Read only'); });
    expect(getUpgradeCapability().mode).toBe('manual');
  });
  it('does not probe the host PM2 daemon from a container', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    expect(getUpgradeCapability()).toEqual({ runtime: 'docker', mode: 'manual' });
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

it('uses deployment instructions for cluster mode', () => {
  vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ name: 'sellf-matrix', pm2_env: { exec_mode: 'cluster_mode', pm_cwd: process.cwd() } }]));
  expect(getUpgradeCapability().mode).toBe('manual');
});
