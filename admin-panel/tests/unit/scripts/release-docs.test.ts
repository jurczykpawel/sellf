import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { VERSION_FILES, readVersions } from '@/../scripts/release-bump';

const repo = resolve(__dirname, '../../../..');
const script = join(repo, 'admin-panel/scripts/release-bump.ts');
let root: string;
function git(...args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
function commit(subject: string) {
  git('add', '.');
  git('commit', '--allow-empty', '-m', subject);
  return git('rev-parse', 'HEAD');
}
function run(...args: string[]) {
  return spawnSync('bun', [script, '--root', root, ...args], { encoding: 'utf8' });
}
function record(hash: string, docs: string[]) {
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs/release-docs.json'), JSON.stringify({ [hash]: docs }));
}
function page() {
  for (const lang of ['', 'pl/']) {
    const file = join(root, `docs-site/src/content/docs/${lang}checkout.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '# Checkout\n');
  }
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sellf-docs-'));
  for (const { file } of VERSION_FILES) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repo, file), join(root, file));
  }
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'test@example.invalid');
  commit('chore: baseline');
  git('tag', 'v2000.1.0');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('release documentation gate through the bump command', () => {
  it('refuses a missing record before changing any version file', () => {
    const hash = commit('feat: add checkout');
    const before = readVersions(root);
    const r = run('2099.1.0');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`Missing docs record: ${hash}`);
    expect(readVersions(root)).toEqual(before);
  });
  it('refuses a missing page and a missing Polish translation', () => {
    const hash = commit('fix: improve checkout');
    record(hash, ['checkout.md']);
    expect(run('2099.1.0').stderr).toContain('checkout.md');
    page();
    rmSync(join(root, 'docs-site/src/content/docs/pl/checkout.md'));
    const r = run('2099.1.0');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pl/checkout.md');
  });
  it('accepts complete bilingual records across no-ff merge and ignores an RC tag', () => {
    git('switch', '-c', 'feature');
    const hash = commit('feat: add checkout');
    git('switch', 'main');
    git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
    git('tag', 'v2099.1.0-rc.1');
    page();
    record(hash, ['checkout.md']);
    expect(run('2099.1.0').status).toBe(0);
    expect(run('--check', '2099.1.0').status).toBe(0);
  });
  it('requires a reason for none and permits a justified technical correction', () => {
    const hash = commit('fix: align build output');
    record(hash, ['none']);
    expect(run('2099.1.0').status).toBe(1);
    record(hash, ['none — Build layout only; no seller-facing behaviour changes.']);
    expect(run('2099.1.0').status).toBe(0);
  });
  it('does not let --check or --no-tag-check skip documentation', () => {
    commit('perf: render checkout faster');
    expect(run('--check').status).toBe(1);
    expect(run('2099.1.0', '--no-tag-check').status).toBe(1);
  });
  it('requires records for breaking chores, but not ordinary chores/tests/docs', () => {
    commit('chore: tooling');
    commit('test: checkout');
    commit('docs: guide');
    expect(run('--check').status).toBe(0);
    commit('chore!: change deployment contract');
    expect(run('--check').status).toBe(1);
  });
  it('requires records for a breaking footer on an ordinary chore', () => {
    commit('chore: deployment contract\n\nBREAKING CHANGE: Set the new deployment option.');
    expect(run('--check').status).toBe(1);
  });
  it.each([[], ['../checkout.md'], ['pl/checkout.md']])('refuses an invalid page record %j', (...pages) => {
    const hash = commit('fix: improve checkout');
    record(hash, pages);
    expect(run('2099.1.0').status).toBe(1);
  });
  it('checks the whole stable range even when notes --from is shortened', () => {
    const hash = commit('feat: add checkout');
    commit('chore: package');
    const r = spawnSync('bun', [join(repo, 'admin-panel/scripts/release-notes.ts'), '--root', root, '--from', 'HEAD', '--version', '2099.1.0'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(hash);
  });
  it('checks coverage on a tagged release and refuses missing tag history', () => {
    commit('feat: add checkout');
    git('tag', 'v2026.11.1');
    expect(run('--check', '2026.11.1').status).toBe(1);
    git('tag', '-d', 'v2000.1.0');
    expect(run('--check', '2026.11.1').stderr).toContain('No previous stable tag');
  });
  it('notes use the same records and refuse missing records', () => {
    const hash = commit('fix: improve checkout');
    const notes = join(repo, 'admin-panel/scripts/release-notes.ts');
    const args = [notes, '--root', root, '--version', '2099.1.0'];
    expect(spawnSync('bun', args).status).toBe(1);
    page();
    record(hash, ['checkout.md']);
    const r = spawnSync('bun', args, { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('https://docs.sellf.app/checkout/');
    expect(r.stdout).toContain('https://docs.sellf.app/pl/checkout/');
  });
});
