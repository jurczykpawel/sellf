#!/usr/bin/env bun
/**
 * Release notes draft from commit prefixes. Sellf merges local branches without PRs, so the
 * notes come from Conventional Commits (`type(scope)!: subject`, `BREAKING CHANGE: …` footer)
 * between the last release tag and HEAD, not from PR labels.
 *
 *   bun run release:notes [--from <tag>] [--to <ref>] [--version <YYYY.M.patch>] [--out <file>]
 *   bun run release:notes --check <file>   — exit 1 while the Highlights were not written
 *
 * Defaults: --from = last v* tag reachable from --to, --to = HEAD, --version = admin-panel/package.json.
 * The release skill writes only the Highlights (replacing the marker) and runs --check before
 * `gh release create --notes-file`.
 *
 * @see tests/unit/scripts/release-notes.test.ts
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HIGHLIGHTS_MARKER = '<!-- HIGHLIGHTS: 3-4 bullets for sellers, written by the release skill; release:notes --check fails while this line is here -->';
const REPO_URL = 'https://github.com/jurczykpawel/sellf';

export interface RawCommit {
  hash: string;
  subject: string;
  body: string;
}

export interface ParsedCommit {
  hash: string;
  type: string;
  scope: string | null;
  subject: string;
  breaking: string | null;
}

const SECTIONS: { heading: string; match: (c: ParsedCommit) => boolean }[] = [
  { heading: 'New features', match: (c) => c.type === 'feat' },
  { heading: 'Fixes', match: (c) => c.type === 'fix' },
  { heading: 'Performance', match: (c) => c.type === 'perf' },
  { heading: 'Documentation', match: (c) => c.type === 'docs' },
  { heading: 'Tests', match: (c) => c.type === 'test' },
  { heading: 'Dependencies', match: (c) => c.type === 'chore' && c.scope === 'deps' },
  { heading: 'Maintenance', match: () => true },
];

const VERSION_BUMP_RE = /^chore(\(release\))?: bump version to /;

/** A footer line per Conventional Commits: `Token: value` / `Token #value` (or `BREAKING CHANGE: value`). */
const FOOTER_RE = /^(?:BREAKING[ -]CHANGES?|[A-Za-z][\w-]*)(?:: | #)/;

/**
 * Text of the BREAKING CHANGE footer: the first line plus every continuation line and paragraph
 * up to the next footer or the end of the message (a migration note is often several paragraphs).
 */
function breakingFooter(body: string): string | null {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^BREAKING[ -]CHANGES?:\s*\S/.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && FOOTER_RE.test(line));
  const text = lines.slice(start, end < 0 ? undefined : end).join('\n').replace(/^BREAKING[ -]CHANGES?:\s*/, '');
  return text.replace(/\s+$/, '');
}

export function parseCommit({ hash, subject, body }: RawCommit): ParsedCommit {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject.trim());
  const footer = breakingFooter(body);
  if (!match) return { hash, type: 'other', scope: null, subject: subject.trim(), breaking: footer };
  const [, type, rawScope, bang, rawSubject] = match;
  // Internal task ids (e.g. W123b) mean nothing to sellers.
  const cleanSubject = rawSubject.replace(/\s*\(W\d+[a-z]*\)$/i, '').trim();
  const scope = rawScope && !/^w\d+[a-z]*$/i.test(rawScope) ? rawScope : null;
  const breaking = footer ?? (bang ? cleanSubject : null);
  return { hash, type, scope, subject: cleanSubject, breaking };
}

/** One list item; continuation lines are indented so a multi-paragraph text stays in the item. */
function bullet(scope: string | null, text: string, hash: string): string {
  const body = text.split('\n').map((line, i) => (i === 0 || line === '' ? line : `  ${line}`)).join('\n');
  return `- ${scope ? `**${scope}:** ` : ''}${body} (${hash.slice(0, 7)})`;
}

export interface NotesOptions {
  version: string;
  from: string;
  repoUrl?: string;
}

export function buildReleaseNotes(commits: RawCommit[], { version, from, repoUrl = REPO_URL }: NotesOptions): string {
  const parsed = commits.filter((c) => !VERSION_BUMP_RE.test(c.subject)).map(parseCommit);
  // Unscoped first, then scopes alphabetically; chronological inside a scope (stable sort).
  const byScope = (a: ParsedCommit, b: ParsedCommit) => {
    const [x, y] = [a.scope ?? '', b.scope ?? ''];
    return x === y ? 0 : x < y ? -1 : 1;
  };
  const out: string[] = ['## Highlights', '', HIGHLIGHTS_MARKER, ''];

  const breaking = parsed.filter((c) => c.breaking).sort(byScope);
  if (breaking.length) out.push('## Breaking changes', '', ...breaking.map((c) => bullet(c.scope, c.breaking!, c.hash)), '');

  const remaining = [...parsed];
  for (const { heading, match } of SECTIONS) {
    const inSection = remaining.filter(match);
    for (const c of inSection) remaining.splice(remaining.indexOf(c), 1);
    if (inSection.length) out.push(`## ${heading}`, '', ...inSection.sort(byScope).map((c) => bullet(c.scope, c.subject, c.hash)), '');
  }

  out.push('---', '', `${parsed.length} commits since ${from}.`, '', `**Full Changelog**: ${repoUrl}/compare/${from}...v${version}`, '');
  return out.join('\n');
}

export function checkNotesReady(notes: string): string[] {
  const errors: string[] = [];
  if (notes.includes(HIGHLIGHTS_MARKER)) errors.push('Highlights not written: replace the HIGHLIGHTS marker with 3-4 bullets');
  const highlights = /## Highlights\n([\s\S]*?)(\n## |\n---)/.exec(notes);
  if (!highlights || !/^- \S/m.test(highlights[1])) errors.push('The Highlights section has no bullet');
  return errors;
}

// ===== GIT (integration) =====

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function readCommits(root: string, from: string, to: string): RawCommit[] {
  const log = git(root, ['log', '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${from}..${to}`]);
  return log
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, subject, body = ''] = record.split('\x1f');
      return { hash, subject, body };
    });
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
  const args = process.argv.slice(2);
  const check = option(args, '--check');
  if (check) {
    const errors = checkNotesReady(readFileSync(check, 'utf8'));
    for (const error of errors) console.error(`✖ ${error}`);
    if (errors.length) process.exit(1);
    console.log(`✓ ${check} is ready to publish`);
    return;
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    const to = option(args, '--to') ?? 'HEAD';
    const from = option(args, '--from') ?? git(root, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', to]).trim();
    const version = option(args, '--version') ?? JSON.parse(readFileSync(join(root, 'admin-panel/package.json'), 'utf8')).version;
    const notes = buildReleaseNotes(readCommits(root, from, to), { version, from });
    const out = option(args, '--out');
    if (out) {
      writeFileSync(out, notes);
      console.error(`✓ Draft written to ${out}; fill in the Highlights, then: bun run release:notes --check ${out}`);
    } else {
      process.stdout.write(notes);
    }
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
