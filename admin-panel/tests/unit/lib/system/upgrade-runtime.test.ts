/** @see src/lib/system/upgrade-runtime.ts */
import { describe, expect, it } from 'vitest';
import { detectUpgradeRuntime } from '@/lib/system/upgrade-runtime';

const ready = { container: false, standalone: true, root: true, linux: true, systemd: true, pm2: true, script: true };
describe('upgrade runtime capabilities', () => {
  it('offers in-place upgrades only for a ready standalone PM2 installation', () => {
    expect(detectUpgradeRuntime({ pm_id: '0' }, ready)).toEqual({ runtime: 'pm2', mode: 'in-place' });
  });
  it.each(['docker', 'compose', 'coolify', 'vercel', 'netlify', 'systemd', 'manual'])('honours %s deployment override', (runtime) => {
    expect(detectUpgradeRuntime({ SELLF_DEPLOYMENT_RUNTIME: runtime, pm_id: '0' }, ready)).toEqual({ runtime, mode: 'manual' });
  });
  it.each([
    [{ VERCEL: '1' }, 'vercel'], [{ NETLIFY: 'true' }, 'netlify'],
    [{ COOLIFY_RESOURCE_UUID: 'resource' }, 'coolify'], [{ INVOCATION_ID: 'unit' }, 'systemd'],
    [{}, 'manual'],
  ])('detects platform signals %j', (env, runtime) => {
    expect(detectUpgradeRuntime(env, ready)).toEqual({ runtime, mode: 'manual' });
  });
  it('detects containers before inherited PM2 signals', () => {
    expect(detectUpgradeRuntime({ pm_id: '0' }, { ...ready, container: true })).toEqual({ runtime: 'docker', mode: 'manual' });
  });
  it('does not enable in-place upgrades inside containers even with a PM2 override', () => {
    expect(detectUpgradeRuntime({ SELLF_DEPLOYMENT_RUNTIME: 'pm2' }, { ...ready, container: true }).mode).toBe('manual');
  });
  it.each(['standalone', 'root', 'linux', 'systemd', 'pm2', 'script'] as const)('requires %s preflight', (signal) => {
    expect(detectUpgradeRuntime({ SELLF_DEPLOYMENT_RUNTIME: 'pm2' }, { ...ready, [signal]: false })).toEqual({ runtime: 'pm2', mode: 'manual' });
  });
  it('uses manual mode for an invalid explicit runtime', () => {
    expect(detectUpgradeRuntime({ SELLF_DEPLOYMENT_RUNTIME: 'typo', pm_id: '0' }, ready)).toEqual({ runtime: 'manual', mode: 'manual' });
  });
});
