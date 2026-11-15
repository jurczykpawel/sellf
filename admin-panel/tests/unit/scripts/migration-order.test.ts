import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  checkMigrationOrder,
  checkReleaseSize,
  parseOrderFile,
  readReleasedMigrations,
} from '@/../scripts/migration-order';

const A = '20260101000000_a.sql';
const B = '20260201000000_b.sql';
const C = '20260301000000_c.sql';
const D = '20260401000000_d.sql';

function check(overrides: Partial<Parameters<typeof checkMigrationOrder>[0]> = {}) {
  return checkMigrationOrder({
    order: [A, B, C],
    files: [A, B, C],
    released: { base: 'v2026.1.0', migrations: [A, B] },
    releasedChanged: [],
    ...overrides,
  });
}

describe('parseOrderFile', () => {
  it('reads one migration per line, skipping comments and blank lines', () => {
    expect(parseOrderFile(`# header\n\n${A}\n  ${B}  \n`)).toEqual([A, B]);
  });
});

describe('checkMigrationOrder', () => {
  it('passes when the list matches the files and keeps the released prefix', () => {
    expect(check()).toEqual([]);
  });

  it('fails for a migration file missing from the list', () => {
    expect(check({ files: [A, B, C, D] }).join('\n')).toContain(`${D} is not listed`);
  });

  it('fails for a listed entry without a file', () => {
    expect(check({ order: [A, B, C, D] }).join('\n')).toContain(`${D} is listed but the file does not exist`);
  });

  it('fails for a duplicated entry', () => {
    expect(check({ order: [A, B, C, C] }).join('\n')).toContain(`${C} is listed twice`);
  });

  it('fails when entries are out of timestamp order', () => {
    expect(check({ order: [A, C, B], released: { base: 'v2026.1.0', migrations: [A] } }).join('\n')).toContain(`${B} comes after ${C}`);
  });

  it('fails for a malformed entry name', () => {
    expect(check({ order: [A, B, C, 'notes.sql'], files: [A, B, C, 'notes.sql'] }).join('\n')).toContain('notes.sql is not <14-digit timestamp>_<name>.sql');
  });

  it('fails when a released entry is removed', () => {
    const errors = check({ order: [A, C], files: [A, C] });
    expect(errors.join('\n')).toContain(`released in v2026.1.0`);
    expect(errors.join('\n')).toContain(B);
  });

  it('fails when a released entry is renamed', () => {
    const renamed = '20260201000000_b_renamed.sql';
    expect(check({ order: [A, renamed, C], files: [A, renamed, C] }).join('\n')).toContain(`position 2 must stay ${B}`);
  });

  it('fails when a new migration is placed before a released one', () => {
    const early = '20260115000000_early.sql';
    const errors = check({ order: [A, early, B, C], files: [A, early, B, C] });
    expect(errors.join('\n')).toContain(`position 2 must stay ${B}`);
  });

  it('fails when a released migration file was modified or deleted', () => {
    expect(check({ releasedChanged: [B] }).join('\n')).toContain(`${B} was released in v2026.1.0 and has been modified or deleted`);
  });

  it('allows rewriting unreleased entries (consolidation before the release)', () => {
    const consolidated = '20260301000000_release_consolidated.sql';
    expect(check({ order: [A, B, consolidated], files: [A, B, consolidated] })).toEqual([]);
  });
});

describe('checkReleaseSize (release build only)', () => {
  const released = { base: 'v2026.1.0', migrations: [A] };
  const added = (n: number) => Array.from({ length: n }, (_, i) => `2026020${i}000000_m${i}.sql`);

  it('accepts at most 8 migrations added since the previous release', () => {
    expect(checkReleaseSize([A, ...added(8)], released, 8)).toEqual([]);
  });

  it('fails with 9 added migrations and tells to consolidate', () => {
    expect(checkReleaseSize([A, ...added(9)], released, 8).join('\n')).toContain('9 migrations added since v2026.1.0 (limit 8)');
  });
});

describe('migration order file in git', () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'sellf-order-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(repo, 'supabase/migrations'), { recursive: true });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('two branches appending a migration conflict instead of merging silently', () => {
    writeFileSync(path.join(repo, 'supabase/migration-order.txt'), `${A}\n${B}\n`);
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'one');
    writeFileSync(path.join(repo, 'supabase/migration-order.txt'), `${A}\n${B}\n${C}\n`);
    git('commit', '-qam', 'one');
    git('checkout', '-q', 'main');
    git('checkout', '-qb', 'two');
    writeFileSync(path.join(repo, 'supabase/migration-order.txt'), `${A}\n${B}\n${D}\n`);
    git('commit', '-qam', 'two');
    git('checkout', '-q', 'main');
    git('merge', '-q', 'one');
    const conflict = spawnSync('git', ['merge', 'two'], { cwd: repo, encoding: 'utf8' });
    expect(conflict.status).not.toBe(0);
    expect(conflict.stdout).toContain('CONFLICT');
    expect(readFileSync(path.join(repo, 'supabase/migration-order.txt'), 'utf8')).toContain('<<<<<<<');
  });

  it('reads the released list from the order file at the tag', () => {
    writeFileSync(path.join(repo, 'supabase/migration-order.txt'), `# list\n${A}\n${B}\n`);
    git('add', '.');
    git('commit', '-qm', 'release');
    git('tag', 'v2026.1.0');
    expect(readReleasedMigrations(repo, 'v2026.1.0')).toEqual({ base: 'v2026.1.0', migrations: [A, B] });
  });

  it('falls back to the sorted migration files at a tag made before the order file existed', () => {
    writeFileSync(path.join(repo, 'supabase/migrations', B), 'SELECT 2;');
    writeFileSync(path.join(repo, 'supabase/migrations', A), 'SELECT 1;');
    mkdirSync(path.join(repo, 'supabase/migrations/snippets'));
    writeFileSync(path.join(repo, 'supabase/migrations/snippets/x.sql'), 'SELECT 3;');
    git('add', '.');
    git('commit', '-qm', 'release');
    git('tag', 'v2026.1.0');
    expect(readReleasedMigrations(repo, 'v2026.1.0')).toEqual({ base: 'v2026.1.0', migrations: [A, B] });
  });
});
