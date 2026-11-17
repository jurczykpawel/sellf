/**
 * Maintenance mode, the server source: a file (like WordPress `.maintenance`) or an env flag,
 * read without any database. @see src/lib/maintenance/file.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMaintenanceFilePath, readServerMaintenance } from '@/lib/maintenance/file';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sellf-maintenance-'));
  vi.stubEnv('SELLF_MAINTENANCE_FILE', path.join(dir, 'MAINTENANCE'));
  vi.stubEnv('SELLF_MAINTENANCE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('maintenance file path', () => {
  it('uses SELLF_MAINTENANCE_FILE when set', () => {
    expect(getMaintenanceFilePath()).toBe(path.join(dir, 'MAINTENANCE'));
  });

  it('is <install>/MAINTENANCE in a standalone release, next to .env.local and scripts/upgrade.sh', () => {
    vi.stubEnv('SELLF_MAINTENANCE_FILE', '');
    vi.spyOn(process, 'cwd').mockReturnValue('/opt/stacks/sellf-tsa/admin-panel/.next/standalone/admin-panel');
    expect(getMaintenanceFilePath()).toBe('/opt/stacks/sellf-tsa/admin-panel/MAINTENANCE');
  });

  it('resolves a relative SELLF_MAINTENANCE_FILE against the installation directory, as upgrade.sh does', () => {
    vi.stubEnv('SELLF_MAINTENANCE_FILE', ' var/maintenance.flag ');
    vi.spyOn(process, 'cwd').mockReturnValue('/opt/stacks/sellf-tsa/admin-panel/.next/standalone/admin-panel');
    expect(getMaintenanceFilePath()).toBe('/opt/stacks/sellf-tsa/admin-panel/var/maintenance.flag');
  });

  it('is <cwd>/MAINTENANCE outside a standalone release (dev, Docker)', () => {
    vi.stubEnv('SELLF_MAINTENANCE_FILE', '');
    vi.spyOn(process, 'cwd').mockReturnValue('/app');
    expect(getMaintenanceFilePath()).toBe('/app/MAINTENANCE');
  });
});

describe('readServerMaintenance', () => {
  it('is off without the file and the env flag', () => {
    expect(readServerMaintenance()).toBeNull();
  });

  it('an empty file switches it on with no message', () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), '');
    expect(readServerMaintenance()).toEqual({ source: 'file', path: path.join(dir, 'MAINTENANCE'), reason: null, message: null, expectedEndAt: null, startedAt: null });
  });

  it('plain text in the file is the message shown to visitors', () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), '  We are moving to a new server.\n');
    expect(readServerMaintenance()).toMatchObject({ source: 'file', message: 'We are moving to a new server.' });
  });

  it('reads the JSON written by upgrade.sh', () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), JSON.stringify({ reason: 'upgrade', started_at: '2026-11-17T10:00:00Z', message: 'Updating to v2026.11.1', expected_end_at: '2026-11-17T10:10:00Z' }));
    expect(readServerMaintenance()).toMatchObject({ reason: 'upgrade', startedAt: '2026-11-17T10:00:00Z', message: 'Updating to v2026.11.1', expectedEndAt: '2026-11-17T10:10:00Z' });
  });

  it('ignores invalid JSON fields instead of showing them', () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), JSON.stringify({ reason: 42, message: 'x'.repeat(501), expected_end_at: 'tomorrow' }));
    expect(readServerMaintenance()).toMatchObject({ source: 'file', reason: null, message: null, expectedEndAt: null });
  });

  it('a file it cannot read still switches it on (fail closed)', () => {
    mkdirSync(path.join(dir, 'MAINTENANCE'));
    expect(readServerMaintenance()).toMatchObject({ source: 'file', message: null });
  });

  it.each(['true', '1', 'on', 'yes'])('SELLF_MAINTENANCE=%s switches it on from the environment', value => {
    vi.stubEnv('SELLF_MAINTENANCE', value);
    expect(readServerMaintenance()).toMatchObject({ source: 'env', path: null });
  });

  it('the file wins over the env flag', () => {
    vi.stubEnv('SELLF_MAINTENANCE', 'true');
    writeFileSync(path.join(dir, 'MAINTENANCE'), 'file message');
    expect(readServerMaintenance()).toMatchObject({ source: 'file', message: 'file message' });
  });

  it.each(['false', '0', ''])('SELLF_MAINTENANCE=%s leaves it off', value => {
    vi.stubEnv('SELLF_MAINTENANCE', value);
    expect(readServerMaintenance()).toBeNull();
  });
});
