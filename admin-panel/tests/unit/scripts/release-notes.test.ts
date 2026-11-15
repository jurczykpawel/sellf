import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  HIGHLIGHTS_MARKER,
  buildReleaseNotes,
  checkNotesReady,
  parseCommit,
} from '@/../scripts/release-notes';

const REPO = path.resolve(__dirname, '../../../..');
const SCRIPT = path.resolve(__dirname, '../../../scripts/release-notes.ts');
const OPTS = { version: '2026.11.1', from: 'v2026.11.0', repoUrl: 'https://github.com/jurczykpawel/sellf' };

describe('parseCommit', () => {
  it('reads type, scope and subject, dropping internal task ids', () => {
    expect(parseCommit({ hash: 'a'.repeat(40), subject: 'fix(orders): late transfer preview counts the tier (W254b)', body: '' })).toMatchObject({
      type: 'fix', scope: 'orders', subject: 'late transfer preview counts the tier', breaking: null,
    });
  });

  it('drops internal worker scopes but keeps issue scopes', () => {
    expect(parseCommit({ hash: 'b'.repeat(40), subject: 'fix(w224): refuse invalid section order', body: '' }).scope).toBeNull();
    expect(parseCommit({ hash: 'c'.repeat(40), subject: 'fix(#73): keep the locale', body: '' }).scope).toBe('#73');
  });

  it('marks "!" and a BREAKING CHANGE footer as breaking, with the footer text', () => {
    expect(parseCommit({ hash: 'd'.repeat(40), subject: 'feat(api)!: drop v0 endpoints', body: '' }).breaking).toBe('drop v0 endpoints');
    expect(parseCommit({ hash: 'e'.repeat(40), subject: 'feat(webhooks): new payload', body: 'Details.\n\nBREAKING CHANGE: `order.paid` renamed to `order.completed`.' }).breaking)
      .toBe('`order.paid` renamed to `order.completed`.');
    expect(parseCommit({ hash: 'f'.repeat(40), subject: 'fix(x): y', body: 'this is a non-breaking tweak' }).breaking).toBeNull();
  });

  it('treats a non-conventional subject as "other"', () => {
    expect(parseCommit({ hash: '1'.repeat(40), subject: 'Update README', body: '' })).toMatchObject({ type: 'other', scope: null, subject: 'Update README' });
  });
});

describe('buildReleaseNotes', () => {
  const commits = [
    { hash: '1111111aaaa', subject: 'feat(orders): cancelled order cannot be paid (W254)', body: '' },
    { hash: '2222222bbbb', subject: 'fix(stripe): skip foreign events', body: '' },
    { hash: '3333333cccc', subject: 'feat(api)!: remove legacy field', body: 'BREAKING CHANGE: clients must read `amount_total`.' },
    { hash: '4444444dddd', subject: 'docs(updater): explain the unknown outcome', body: '' },
    { hash: '5555555eeee', subject: 'test(events): wait for retry', body: '' },
    { hash: '6666666ffff', subject: 'chore: bump version to 2026.11.1', body: '' },
    { hash: '7777777aaaa', subject: 'ci(migrations): schema snapshot', body: '' },
  ];
  const notes = buildReleaseNotes(commits, OPTS);

  it('starts with a Highlights section for the release skill to fill', () => {
    expect(notes).toMatch(/^## Highlights\n\n<!-- HIGHLIGHTS/);
    expect(notes).toContain(HIGHLIGHTS_MARKER);
  });

  it('groups commits into sections in a fixed order, breaking changes first', () => {
    const order = ['## Breaking changes', '## New features', '## Fixes', '## Documentation', '## Tests', '## Maintenance'].map((h) => notes.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('writes scoped bullets with short hashes and the breaking footer text', () => {
    expect(notes).toContain('- **orders:** cancelled order cannot be paid (1111111)');
    expect(notes).toContain('- **api:** clients must read `amount_total`. (3333333)');
    expect(notes).toContain('- **api:** remove legacy field (3333333)');
    expect(notes).not.toContain('W254');
  });

  it('leaves out version bump commits and ends with stats and the compare link', () => {
    expect(notes).not.toContain('bump version');
    expect(notes).toContain('6 commits');
    expect(notes.trimEnd().endsWith('**Full Changelog**: https://github.com/jurczykpawel/sellf/compare/v2026.11.0...v2026.11.1')).toBe(true);
  });

  it('omits empty sections', () => {
    expect(buildReleaseNotes([commits[1]], OPTS)).not.toContain('## New features');
  });
});

describe('checkNotesReady', () => {
  it('refuses notes whose Highlights were not written', () => {
    expect(checkNotesReady(buildReleaseNotes([], OPTS))).not.toEqual([]);
  });
  it('accepts notes after the marker is replaced with highlights', () => {
    const filled = buildReleaseNotes([], OPTS).replace(HIGHLIGHTS_MARKER, '- Orders can no longer be paid after cancellation.');
    expect(checkNotesReady(filled)).toEqual([]);
  });
});

const hasRealRange = spawnSync('git', ['rev-parse', '--verify', '-q', 'v2026.11.0^{commit}'], { cwd: REPO }).status === 0
  && spawnSync('git', ['rev-parse', '--verify', '-q', '92acfbbd^{commit}'], { cwd: REPO }).status === 0;

describe.skipIf(!hasRealRange)('CLI on the real history v2026.11.0..92acfbbd', () => {
  it('classifies all 78 non-merge commits', () => {
    const run = spawnSync('bun', [SCRIPT, '--from', 'v2026.11.0', '--to', '92acfbbd', '--version', '2026.11.1'], { cwd: REPO, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const bullets = (heading: string) => {
      const start = run.stdout.indexOf(`## ${heading}\n`);
      const end = run.stdout.indexOf('\n## ', start + 1);
      return run.stdout.slice(start, end < 0 ? undefined : end).split('\n').filter((l) => l.startsWith('- ')).length;
    };
    expect(bullets('New features')).toBe(18);
    expect(bullets('Fixes')).toBe(38);
    expect(bullets('Documentation')).toBe(6);
    expect(bullets('Tests')).toBe(9);
    expect(run.stdout).not.toContain('## Breaking changes');
    expect(run.stdout).toContain('78 commits');
  });
});
