/** Exercises the installed script preflight with a minimal PATH. @see scripts/upgrade.sh */
import { randomUUID } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../../scripts/upgrade.sh'), 'utf8');
function run(hasPm2: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-pm2-'));
  const bin = path.join(dir, 'bin');
  const install = path.join(dir, 'install');
  mkdirSync(bin); mkdirSync(install); mkdirSync(path.join(dir, '.bun/bin'), { recursive: true });
  writeFileSync(path.join(install, 'sentinel'), 'unchanged');
  for (const tool of ['cat', 'mkdir', 'touch', 'chmod', 'sed', 'date', 'basename', 'dirname', 'rm']) {
    symlinkSync(execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), path.join(bin, tool));
  }
  writeFileSync(path.join(bin, 'id'), '#!/bin/bash\necho 1000\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'flock'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'node'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  if (hasPm2) writeFileSync(path.join(dir, '.bun/bin/pm2'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$HOME/calls"\n', { mode: 0o755 });
  const token = randomUUID();
  const script = path.join(dir, 'preflight.sh');
  writeFileSync(script, source.slice(0, source.indexOf('# ===== STEP 1: GET LATEST RELEASE INFO =====')) + '\n}\nmain "$@"\n');
  try {
    const result = spawnSync('/bin/bash', [script, token, install], { env: { HOME: dir, PATH: bin }, encoding: 'utf8' });
    const progress = readFileSync(`/tmp/sellf-upgrade-${token}.json`, 'utf8');
    expect(readFileSync(path.join(install, 'sentinel'), 'utf8')).toBe('unchanged');
    expect(readdirSync(install)).toEqual(['sentinel']);
    if (hasPm2) {
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(path.join(dir, 'calls'), 'utf8')).toContain('describe');
      expect(readFileSync(`/tmp/sellf-upgrade-${token}.log`, 'utf8')).toContain(`PM2_BIN: ${dir}/.bun/bin/pm2`);
    } else {
      expect(result.status).toBe(1);
      expect(progress).toContain('PM2 executable not found');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const ext of ['json', 'log']) rmSync(`/tmp/sellf-upgrade-${token}.${ext}`, { force: true });
  }
}
describe('upgrade PM2 preflight', () => {
  it('finds and uses HOME/.bun/bin/pm2 outside PATH', () => run(true));
  it('fails before download or file changes when PM2 is absent', () => run(false));
  it('uses the resolved executable for every PM2 invocation including rollback', () => {
    expect(source).not.toMatch(/(?:^|\s)pm2 (?:describe|stop|start|delete|save) /m);
  });
});
