/** Shared, blocking documentation contract for versioning and release notes. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Commit { hash: string; subject: string; body: string }
export type DocsRecords = Record<string, string[]>;

export function stableBase(root: string, version: string, to = 'HEAD'): string {
  const result = spawnSync('git', ['tag', '--merged', to, '--sort=-version:refname'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot read stable tags: ${result.stderr}`);
  const target = version.split('-')[0].split('.').map(Number);
  const tag = result.stdout.split('\n').find((tag) => {
    if (!/^v\d{4}\.[1-9]\d?\.(0|[1-9]\d*)$/.test(tag)) return false;
    const parts = tag.slice(1).split('.').map(Number);
    return (parts[0] - target[0] || parts[1] - target[1] || parts[2] - target[2]) < 0;
  });
  if (!tag) throw new Error('No previous stable tag found; fetch release tags before versioning');
  return tag;
}

export function needsDocs(commit: Commit): boolean {
  return /^(feat|fix|perf)(\([^)]+\))?!?:/.test(commit.subject) ||
    /^[a-z]+(\([^)]+\))?!:/.test(commit.subject) || /^BREAKING[ -]CHANGES?:\s*\S/m.test(commit.body);
}

export function readDocsRecords(root: string): DocsRecords {
  const file = join(root, 'docs/release-docs.json');
  if (!existsSync(file)) return {};
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid docs/release-docs.json: expected SHA → string[]');
  for (const [hash, pages] of Object.entries(value)) {
    if (!/^[a-f0-9]{40}$/.test(hash) || !Array.isArray(pages) || !pages.length || pages.some((p) => typeof p !== 'string')) {
      throw new Error(`Invalid docs record: ${hash}`);
    }
  }
  return value as DocsRecords;
}

export function docsPages(page: string): string[] {
  return [page, `pl/${page}`];
}

export function checkDocs(root: string, commits: Commit[], records = readDocsRecords(root)): string[] {
  const errors: string[] = [];
  for (const commit of commits) {
    const pages = records[commit.hash];
    if (!pages && !needsDocs(commit)) continue;
    if (!pages?.length) {
      errors.push(`Missing docs record: ${commit.hash} (${commit.subject})`);
      continue;
    }
    if (pages.length === 1 && /^none — \S.+/.test(pages[0])) continue;
    for (const page of pages) {
      if (!/^[a-z0-9][a-z0-9/-]*\.mdx?$/.test(page) || page.startsWith('pl/')) {
        errors.push(`Invalid docs page for ${commit.hash}: ${page}; use an EN page or "none — reason"`);
        continue;
      }
      for (const translated of docsPages(page)) {
        const file = join(root, 'docs-site/src/content/docs', translated);
        if (!existsSync(file) || !statSync(file).isFile()) errors.push(`Missing docs page for ${commit.hash}: ${translated}`);
      }
    }
  }
  return errors;
}

export function docsNote(pages: string[] | undefined): string {
  if (!pages) return '';
  if (pages[0].startsWith('none — ')) return `\n  Docs: ${pages[0]}`;
  return '\n  Docs: ' + pages.flatMap(docsPages).map((page) => {
    const slug = page.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '$1');
    return `[${page}](https://docs.sellf.app/${slug.replace(/\/$/, '')}/)`;
  }).join(', ');
}
