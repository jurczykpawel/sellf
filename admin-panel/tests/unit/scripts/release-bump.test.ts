import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  VERSION_FILES,
  applyBump,
  checkBump,
  parseCalVer,
  readVersions,
} from '@/../scripts/release-bump';

const REPO = path.resolve(__dirname, '../../../..');
const SCRIPT = path.resolve(__dirname, '../../../scripts/release-bump.ts');

describe('parseCalVer', () => {
  it.each(['2026.11.1', '2026.1.0', '2027.12.15'])('accepts %s', (v) => {
    expect(parseCalVer(v)).not.toBeNull();
  });
  it.each(['v2026.11.1', '2026.11', '2026.13.0', '2026.0.1', '2026.01.1', '2026.11.01', '2026.11.1-rc.1', '26.11.1'])('rejects %s', (v) => {
    expect(parseCalVer(v)).toBeNull();
  });
});

describe('checkBump', () => {
  const consistent = (v: string) => Object.fromEntries(VERSION_FILES.map((f) => [f.file, v]));

  it('accepts the next patch in the same month and the first patch of a later month', () => {
    expect(checkBump(consistent('2026.11.1'), '2026.11.2', [])).toEqual([]);
    expect(checkBump(consistent('2026.11.1'), '2026.12.0', [])).toEqual([]);
    expect(checkBump(consistent('2026.12.3'), '2027.1.0', [])).toEqual([]);
  });

  it('rejects a malformed version', () => {
    expect(checkBump(consistent('2026.11.1'), 'v2026.11.2', []).join('\n')).toContain('YYYY.M.patch');
  });

  it('rejects a version that is not newer', () => {
    expect(checkBump(consistent('2026.11.1'), '2026.11.1', []).join('\n')).toContain('must be newer than 2026.11.1');
    expect(checkBump(consistent('2026.11.1'), '2026.10.9', []).join('\n')).toContain('must be newer than 2026.11.1');
  });

  it('rejects a new month that does not start at patch 0', () => {
    expect(checkBump(consistent('2026.11.1'), '2026.12.2', []).join('\n')).toContain('new month starts at patch 0');
  });

  it('rejects a version that already has a tag', () => {
    expect(checkBump(consistent('2026.11.1'), '2026.11.2', ['v2026.11.2']).join('\n')).toContain('tag v2026.11.2 already exists');
  });

  it('refuses to bump when the files disagree on the current version', () => {
    const files = consistent('2026.11.1');
    files['README.md'] = '2026.11.0';
    expect(checkBump(files, '2026.11.2', []).join('\n')).toContain('README.md has 2026.11.0');
  });

  it('refuses when a version location is missing', () => {
    const files: Record<string, string | null> = consistent('2026.11.1');
    files['docker-compose.yml'] = null;
    expect(checkBump(files, '2026.11.2', []).join('\n')).toContain('docker-compose.yml: version not found');
  });
});

describe('the version files of this repository', () => {
  it('all hold one consistent version (the release build relies on it)', () => {
    const versions = readVersions(REPO);
    const unique = new Set(Object.values(versions));
    expect(Object.values(versions)).not.toContain(null);
    expect(unique.size).toBe(1);
  });
});

describe('applyBump on a copy of the real files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sellf-bump-'));
    for (const { file } of VERSION_FILES) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      copyFileSync(path.join(REPO, file), path.join(dir, file));
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('changes exactly the version in every location and nothing else', () => {
    const before = Object.fromEntries(VERSION_FILES.map(({ file }) => [file, readFileSync(path.join(dir, file), 'utf8')]));
    const current = readVersions(dir)['package.json']!;
    applyBump(dir, '2099.1.0');
    expect(new Set(Object.values(readVersions(dir)))).toEqual(new Set(['2099.1.0']));
    for (const { file } of VERSION_FILES) {
      const after = readFileSync(path.join(dir, file), 'utf8');
      expect(after.replaceAll('2099.1.0', current)).toBe(before[file]);
    }
  });

  it('CLI: bumps, then --check confirms; a bad version exits non-zero without touching files', () => {
    const current = readVersions(dir)['package.json']!;
    const bad = spawnSync('bun', [SCRIPT, '1.2.3', '--root', dir], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(new Set(Object.values(readVersions(dir)))).toEqual(new Set([current]));

    const ok = spawnSync('bun', [SCRIPT, '2099.1.0', '--root', dir, '--no-tag-check'], { encoding: 'utf8' });
    expect(ok.status, ok.stderr).toBe(0);
    const check = spawnSync('bun', [SCRIPT, '--check', '2099.1.0', '--root', dir], { encoding: 'utf8' });
    expect(check.status, check.stderr).toBe(0);
  });

  it('CLI --check fails when one file drifted', () => {
    writeFileSync(path.join(dir, 'README.md'), readFileSync(path.join(dir, 'README.md'), 'utf8').replace(/version-[\d.]+-blue/, 'version-2000.1.0-blue'));
    const check = spawnSync('bun', [SCRIPT, '--check', '--root', dir], { encoding: 'utf8' });
    expect(check.status).not.toBe(0);
    expect(check.stderr).toContain('README.md');
  });
});
