/**
 * Migration order file: `supabase/migration-order.txt` lists every migration, one per line, in
 * the order they apply. It only grows: a new migration is appended at the end, so two branches
 * that each add one conflict in git instead of merging in a silently wrong order.
 *
 * Rules (checked by `bun run lint:migrations`, CI `Migration lint` and the release build):
 * - every `supabase/migrations/*.sql` is listed exactly once and every entry has a file;
 * - entries are `<14-digit timestamp>_<name>.sql` in strictly ascending order;
 * - the entries of the last release tag stay a byte-identical prefix (append-only), and the
 *   released files themselves are not modified or deleted;
 * - entries added after the last tag are not released yet and may be rewritten while
 *   migrations are consolidated before the release (AGENTS.md, Release migration policy 2–3).
 *
 * The file lives outside `supabase/migrations` so the release tarball's migrations directory stays
 * `.sql`-only for the installed upgrade runners.
 *
 * @see scripts/lint-migrations.ts
 */

import { spawnSync } from 'node:child_process';

export const ORDER_FILE = 'supabase/migration-order.txt';
const MIGRATIONS_DIR = 'supabase/migrations';
const ENTRY_RE = /^\d{14}_[A-Za-z0-9_]+\.sql$/;

export interface ReleasedMigrations {
  base: string;
  migrations: string[];
}

export interface MigrationOrderInput {
  order: string[];
  files: string[];
  released: ReleasedMigrations;
  releasedChanged: string[];
}

export function parseOrderFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function checkMigrationOrder({ order, files, released, releasedChanged }: MigrationOrderInput): string[] {
  const errors: string[] = [];
  const listed = new Set<string>();
  const fileSet = new Set(files);

  for (const entry of order) {
    if (listed.has(entry)) errors.push(`${entry} is listed twice in ${ORDER_FILE}`);
    listed.add(entry);
    if (!ENTRY_RE.test(entry)) errors.push(`${entry} is not <14-digit timestamp>_<name>.sql`);
    if (!fileSet.has(entry)) errors.push(`${entry} is listed but the file does not exist in ${MIGRATIONS_DIR}`);
  }
  for (const file of [...files].sort()) {
    if (!listed.has(file)) errors.push(`${file} is not listed in ${ORDER_FILE}; append it at the end`);
  }
  for (let i = 1; i < order.length; i++) {
    if (order[i] <= order[i - 1]) errors.push(`${order[i]} comes after ${order[i - 1]} but does not sort after it; new migrations get a later timestamp and go at the end`);
  }

  released.migrations.forEach((entry, index) => {
    if (order[index] !== entry) {
      errors.push(`${ORDER_FILE} position ${index + 1} must stay ${entry} (released in ${released.base}; released entries are append-only), found ${order[index] ?? 'nothing'}`);
    }
  });
  for (const file of releasedChanged) {
    errors.push(`${file} was released in ${released.base} and has been modified or deleted; released migrations are append-only, add a new migration instead`);
  }
  return errors;
}

/** Release policy point 2: at most `limit` migrations added since the previous release tag. */
export function checkReleaseSize(order: string[], released: ReleasedMigrations, limit: number): string[] {
  const added = order.length - released.migrations.length;
  return added > limit
    ? [`${added} migrations added since ${released.base} (limit ${limit}); consolidate them into a few files grouped by area before the release`]
    : [];
}

// ===== GIT (integration) =====

function git(repoRoot: string, args: string[]): { ok: boolean; out: string; err: string } {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, out: result.stdout ?? '', err: result.stderr ?? '' };
}

/** The last release tag reachable from HEAD, or MIGRATION_ORDER_BASE when set. */
export function resolveReleaseBase(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.MIGRATION_ORDER_BASE) return env.MIGRATION_ORDER_BASE;
  const described = git(repoRoot, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD']);
  if (!described.ok || !described.out.trim()) {
    throw new Error(
      'No release tag (v*) reachable from HEAD, so the released migrations are unknown. ' +
      'Fetch tags (CI: actions/checkout with fetch-depth: 0) or set MIGRATION_ORDER_BASE=<tag>.',
    );
  }
  return described.out.trim();
}

/** Migrations of a release: its order file, or (tags made before the file existed) its sorted .sql files. */
export function readReleasedMigrations(repoRoot: string, base: string): ReleasedMigrations {
  const orderAtBase = git(repoRoot, ['show', `${base}:${ORDER_FILE}`]);
  if (orderAtBase.ok) return { base, migrations: parseOrderFile(orderAtBase.out) };
  const tree = git(repoRoot, ['ls-tree', '--name-only', `${base}:${MIGRATIONS_DIR}`]);
  if (!tree.ok) throw new Error(`Cannot read ${MIGRATIONS_DIR} at ${base}: ${tree.err.trim()}`);
  const migrations = tree.out.split('\n').filter((name) => name.endsWith('.sql')).sort();
  return { base, migrations };
}

/** Released migration files that differ from the release (working tree included) or are gone. */
export function changedReleasedFiles(repoRoot: string, released: ReleasedMigrations): string[] {
  const diff = git(repoRoot, ['diff', '--name-only', '--no-renames', '--diff-filter=MDT', released.base, '--', MIGRATIONS_DIR]);
  if (!diff.ok) throw new Error(`git diff against ${released.base} failed: ${diff.err.trim()}`);
  const releasedSet = new Set(released.migrations);
  return diff.out
    .split('\n')
    .map((line) => line.replace(`${MIGRATIONS_DIR}/`, ''))
    .filter((name) => releasedSet.has(name));
}
