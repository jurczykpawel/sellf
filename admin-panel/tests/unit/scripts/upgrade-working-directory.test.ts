/** @see scripts/upgrade.sh */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { expect, it } from 'vitest';

it('keeps a valid working directory while replacing the standalone tree', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../scripts/upgrade.sh'), 'utf8');
  const from = source.indexOf('# ===== STEP 7: SWAP FILES =====');
  const block = source.slice(from, source.indexOf('# Copy new files', from));
  const install = mkdtempSync(path.join(tmpdir(), 'sellf-cwd-'));
  const cwd = path.join(install, '.next/standalone/admin-panel');
  mkdirSync(cwd, { recursive: true });
  try {
    const result = spawnSync('bash', ['-c', `set -euo pipefail\nwrite_progress() { :; }\nlog() { :; }\n${block}\n/bin/pwd -P\n`], { cwd, env: { ...process.env, INSTALL_DIR: install }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(execFileSync('/bin/pwd', ['-P'], { cwd: install, encoding: 'utf8' }).trim());
  } finally { rmSync(install, { recursive: true, force: true }); }
});
