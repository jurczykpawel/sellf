#!/usr/bin/env bun
/**
 * Release version bump: one command changes the Sellf version everywhere it is written.
 *
 *   bun run release:bump 2026.11.2      — check the version (CalVer YYYY.M.patch, newer than the
 *                                          current one, new month starts at .0, no existing tag,
 *                                          all files agree today) and write it to every location.
 *   bun run release:bump --check [ver]  — exit 1 unless every location holds the same valid CalVer
 *                                          version (and equals `ver` when given). The release build runs it.
 *
 * Runs from the repository root or admin-panel (`--root <dir>` overrides; used by tests).
 * Does not commit: the release skill commits `chore: bump version to <ver>`.
 *
 * @see tests/unit/scripts/release-bump.test.ts
 * @see .github/workflows/build-release.yml (test job, "Version files agree with the tag")
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = String.raw`\d{4}\.\d{1,2}\.\d+`;

interface VersionFile {
  file: string;
  /** One capture group around the version; must match exactly once. */
  pattern: RegExp;
}

/** Every place that carries the Sellf version. docker-compose-contract.test.ts pins the Docker ones. */
export const VERSION_FILES: VersionFile[] = [
  { file: 'package.json', pattern: new RegExp(String.raw`^(  "version": ")(${VERSION})(",)$`, 'm') },
  { file: 'admin-panel/package.json', pattern: new RegExp(String.raw`^(  "version": ")(${VERSION})(",)$`, 'm') },
  { file: 'README.md', pattern: new RegExp(String.raw`(img\.shields\.io/badge/version-)(${VERSION})(-blue)`) },
  { file: 'docker-compose.yml', pattern: new RegExp(String.raw`(ghcr\.io/jurczykpawel/sellf:\$\{SELLF_VERSION:-)(${VERSION})(\})`) },
  { file: '.env.docker.example', pattern: new RegExp(String.raw`^(# SELLF_VERSION=)(${VERSION})(\b)`, 'm') },
];

export interface CalVer {
  year: number;
  month: number;
  patch: number;
}

export function parseCalVer(version: string): CalVer | null {
  const match = /^(\d{4})\.([1-9]|1[0-2])\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), patch: Number(match[3]) };
}

function compareCalVer(a: CalVer, b: CalVer): number {
  return a.year - b.year || a.month - b.month || a.patch - b.patch;
}

export function readVersions(root: string): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const { file, pattern } of VERSION_FILES) {
    const path = join(root, file);
    const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    const matches = [...content.matchAll(global)];
    result[file] = matches.length === 1 ? matches[0][2] : null;
  }
  return result;
}

function notCalVer(version: string): string {
  return `${version} is not CalVer YYYY.M.patch (no "v", no leading zeros, month 1-12)`;
}

/** Errors when the files disagree (or `expected` is given and differs), or the version is not CalVer. */
export function checkConsistent(versions: Record<string, string | null>, expected?: string): string[] {
  const errors: string[] = [];
  for (const [file, version] of Object.entries(versions)) {
    if (version === null) errors.push(`${file}: version not found (exactly one match expected)`);
  }
  const reference = expected ?? versions['admin-panel/package.json'];
  if (reference && !parseCalVer(reference)) errors.push(notCalVer(reference));
  for (const [file, version] of Object.entries(versions)) {
    if (version !== null && reference && version !== reference) errors.push(`${file} has ${version}, expected ${reference}`);
  }
  return errors;
}

export function checkBump(versions: Record<string, string | null>, next: string, tags: string[]): string[] {
  const errors = checkConsistent(versions);
  const target = parseCalVer(next);
  if (!target) return [...errors, notCalVer(next)];
  const currentRaw = versions['admin-panel/package.json'];
  const current = currentRaw ? parseCalVer(currentRaw) : null;
  if (current) {
    if (compareCalVer(target, current) <= 0) errors.push(`${next} must be newer than ${currentRaw}`);
    else if ((target.year !== current.year || target.month !== current.month) && target.patch !== 0) {
      errors.push(`${next}: a new month starts at patch 0 (${target.year}.${target.month}.0)`);
    }
  }
  if (tags.includes(`v${next}`)) errors.push(`tag v${next} already exists`);
  return errors;
}

export function applyBump(root: string, next: string): void {
  for (const { file, pattern } of VERSION_FILES) {
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(pattern, `$1${next}$3`));
  }
}

function gitTags(root: string): string[] {
  const result = spawnSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git tag failed: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}

function main(): void {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const positional = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--root');
  const versions = readVersions(root);

  if (args.includes('--check')) {
    const errors = checkConsistent(versions, positional[0]);
    if (errors.length) {
      for (const error of errors) console.error(`✖ ${error}`);
      process.exit(1);
    }
    console.log(`✓ ${VERSION_FILES.length} version locations agree on ${versions['admin-panel/package.json']}`);
    return;
  }

  const next = positional[0];
  if (!next) {
    console.error('Usage: bun run release:bump <YYYY.M.patch> | --check [version]');
    process.exit(2);
  }
  const errors = checkBump(versions, next, args.includes('--no-tag-check') ? [] : gitTags(root));
  if (errors.length) {
    for (const error of errors) console.error(`✖ ${error}`);
    process.exit(1);
  }
  applyBump(root, next);
  const after = checkConsistent(readVersions(root), next);
  if (after.length) {
    for (const error of after) console.error(`✖ ${error}`);
    process.exit(1);
  }
  console.log(`✓ ${versions['admin-panel/package.json']} → ${next} in ${VERSION_FILES.map((f) => f.file).join(', ')}`);
  console.log(`  Next: git commit -am "chore: bump version to ${next}"`);
}

if (import.meta.main) main();
