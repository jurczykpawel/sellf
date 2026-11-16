#!/usr/bin/env bun
/**
 * Schema snapshot: the database schema that the migrations produce, committed as
 * `supabase/schema.snapshot.sql`.
 *
 *   bun run schema:check    — build a clean database from supabase/migrations and FAIL (exit 1,
 *                             unified diff) when its schema differs from the committed snapshot.
 *   bun run schema:snapshot — same build, then rewrite the snapshot (commit it together with
 *                             the migration that changed it).
 *
 * The clean database is a throwaway Supabase stack (own project id and ports, only the
 * database container, no seed) built by the pinned Supabase CLI, so the result does not
 * depend on the developer's own stack and is the same locally and in CI. Consolidating
 * migrations before a release is correct when `schema:check` still passes (AGENTS.md,
 * Release migration policy, point 4).
 *
 * @see .github/workflows/lint-migrations.yml (job schema-snapshot)
 * @see .github/workflows/build-release.yml (job migrations)
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Same version as `supabase/setup-cli` in the workflows: the CLI picks the Postgres image. */
export const PINNED_SUPABASE_CLI = '2.109.1';
export const SNAPSHOT_PROJECT_ID = 'sellf-schema-snapshot';
const SNAPSHOT_PORT_PREFIX = '659';
const DIFF_LINE_LIMIT = 2000;

/** Everything but the database. GoTrue is not needed: the CLI's database image already holds auth. */
const EXCLUDED_SERVICES = [
  'gotrue', 'realtime', 'storage-api', 'imgproxy', 'kong', 'mailpit', 'postgrest',
  'postgres-meta', 'studio', 'edge-runtime', 'logflare', 'vector', 'supavisor',
].join(',');

/** Schemas owned by Sellf migrations: pg_dump writes their schema (privileges come from the extras). */
const DUMP_SCHEMAS = ['public', 'postgrest'];

/** Platform schemas whose tables Sellf relies on (auth.users triggers, storage policies, cron jobs). */
const PLATFORM_SCHEMAS = ['auth', 'storage', 'cron'];

const sqlList = (names: string[]): string => names.map((name) => `'${name}'`).join(', ');

/** Every schema outside the dump that is not a Postgres system schema. */
const OUTSIDE_DUMP = `n.nspname NOT IN (${sqlList([...DUMP_SCHEMAS, 'pg_catalog', 'information_schema', 'pg_toast'])})
   AND n.nspname !~ '^pg_(toast_)?temp_'`;

/** Last section of the snapshot; tests on a live stack (rows change there) cut the snapshot at it. */
export const ROW_COUNTS_HEADING = '-- rows inserted by migrations, per public table (table | rows); content may hold random ids, counts do not';

/**
 * State the schema-only dump does not carry. Platform objects are listed too: the pinned CLI makes
 * them identical on every run, and a change to them (a disabled auth.users trigger, a grant on a
 * platform table, an inactive cron job) breaks Sellf as surely as a change in `public`.
 *
 * Privileges are canonical records (object | grantee | privilege | grantor | grant option) from
 * aclexplode, ordered, instead of pg_dump's GRANT lines, whose order follows the order the grants
 * were made in. A NULL ACL is expanded to the built-in default, so "never granted" and "granted
 * the default explicitly" are the same state.
 */
const EXTRAS_SQL = String.raw`
\pset format unaligned
\pset tuples_only on
\pset fieldsep ' | '
CREATE TEMP VIEW snapshot_platform_tables AS
  SELECT c.oid, format('%I.%I', n.nspname, c.relname) AS name, c.relkind, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND ${OUTSIDE_DUMP}
     AND (n.nspname IN (${sqlList(PLATFORM_SCHEMAS)})
          OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
          OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));
CREATE TEMP VIEW snapshot_acl_relations AS
  SELECT c.oid, format('%I.%I', n.nspname, c.relname) AS name, c.relkind, c.relowner, c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND (n.nspname IN (${sqlList(DUMP_SCHEMAS)}) OR c.oid IN (SELECT oid FROM snapshot_platform_tables));
\echo '-- extensions (name | schema)'
SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1;
\echo '-- triggers outside the dumped schemas (table | trigger | enabled: O on, D off, R replica, A always | definition)'
SELECT format('%I.%I', n.nspname, c.relname), t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal AND ${OUTSIDE_DUMP}
 ORDER BY 1, 2;
\echo '-- row level security of platform tables (table | enabled | forced)'
SELECT name, relrowsecurity, relforcerowsecurity FROM snapshot_platform_tables WHERE relkind IN ('r', 'p') ORDER BY 1;
\echo '-- policies outside the dumped schemas (table | policy | permissive | roles | command | using | with check)'
SELECT schemaname || '.' || tablename, policyname, permissive, roles::text, cmd, coalesce(qual, '-'), coalesce(with_check, '-')
  FROM pg_policies WHERE schemaname NOT IN (${sqlList(DUMP_SCHEMAS)}) ORDER BY 1, 2;
\echo '-- privileges (object kind | object | grantee | privilege | grantor | grant option)'
WITH objects(kind, name, acl, dflt) AS (
  SELECT 'schema', quote_ident(n.nspname), n.nspacl, acldefault('n', n.nspowner)
    FROM pg_namespace n WHERE n.nspname IN (${sqlList([...DUMP_SCHEMAS, ...PLATFORM_SCHEMAS])})
  UNION ALL
  SELECT CASE r.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                        WHEN 'f' THEN 'foreign table' ELSE 'table' END,
         r.name, r.relacl, acldefault(CASE r.relkind WHEN 'S' THEN 's' ELSE 'r' END::"char", r.relowner)
    FROM snapshot_acl_relations r
  UNION ALL
  SELECT 'column', r.name || '.' || quote_ident(a.attname), a.attacl, NULL
    FROM pg_attribute a JOIN snapshot_acl_relations r ON r.oid = a.attrelid
   WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  UNION ALL
  SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END,
         format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), p.proacl, acldefault('f', p.proowner)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN (${sqlList(DUMP_SCHEMAS)})
  UNION ALL
  SELECT 'type', format('%I.%I', n.nspname, t.typname), t.typacl, acldefault('T', t.typowner)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname IN (${sqlList(DUMP_SCHEMAS)}) AND t.typrelid = 0
     AND NOT EXISTS (SELECT 1 FROM pg_type e WHERE e.typarray = t.oid)
  UNION ALL
  SELECT 'default privileges', format('for %s in %s on %s', d.defaclrole::regrole,
         CASE WHEN d.defaclnamespace = 0 THEN 'all schemas' ELSE d.defaclnamespace::regnamespace::text END,
         CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'functions'
                              WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' ELSE d.defaclobjtype::text END),
         d.defaclacl, NULL
    FROM pg_default_acl d
)
SELECT o.kind, o.name, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
       a.privilege_type, a.grantor::regrole, CASE WHEN a.is_grantable THEN 'WITH GRANT OPTION' ELSE '-' END
  FROM objects o, aclexplode(coalesce(o.acl, o.dflt)) a
 ORDER BY 1, 2, 3, 4, 5, 6;
\echo '-- storage buckets (id | name | public | size limit | mime types)'
SELECT id, name, public, coalesce(file_size_limit::text, '-'), coalesce(allowed_mime_types::text, '-')
  FROM storage.buckets ORDER BY id;
\echo '-- cron jobs (name | schedule | active | database | user | node | port | command)'
SELECT jobname, schedule, active, database, username, nodename, nodeport, command FROM cron.job ORDER BY jobname;
\echo '${ROW_COUNTS_HEADING}'
SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
 ORDER BY 1;
`;

// ===== PURE HELPERS (unit-tested) =====

const RESTRICT_RE = /^\\restrict (\S+)$/;
const VERSION_BANNER_RE = /^-- Dumped (from database|by pg_dump) version /;

/**
 * Drops what changes between pg_dump runs without being SQL content: the version banner and the
 * random `\restrict` key in the comment header before the first statement, and the matching
 * `\unrestrict` line. Everything else, function bodies and their whitespace included, stays byte
 * for byte.
 */
export function normalizeDump(dump: string): string {
  const out: string[] = [];
  let key: string | null = null;
  let inHeader = true;
  for (const line of dump.split('\n')) {
    if (inHeader && !(line === '' || line.startsWith('--') || RESTRICT_RE.test(line))) inHeader = false;
    if (inHeader) {
      const restrict = RESTRICT_RE.exec(line);
      if (restrict) {
        key = restrict[1];
        continue;
      }
      if (VERSION_BANNER_RE.test(line)) continue;
    } else if (key !== null && line === `\\unrestrict ${key}`) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface SnapshotParts {
  cliVersion: string;
  serverVersion: string;
  dump: string;
  extras: string;
}

export function buildSnapshot({ cliVersion, serverVersion, dump, extras }: SnapshotParts): string {
  const header = [
    '-- Sellf schema snapshot: the schema built by applying every file in supabase/migrations',
    '-- to a clean database. Generated by `bun run schema:snapshot` (admin-panel); do not edit.',
    '-- CI fails when the migrations produce anything else (`bun run schema:check`).',
    `-- supabase-cli: ${cliVersion}`,
    `-- postgres: ${serverVersion}`,
  ].join('\n');
  const snapshot = `${header}\n\n${normalizeDump(dump)}\n-- ===== Objects outside the dumped schemas =====\n\n${extras}`;
  return snapshot.endsWith('\n') ? snapshot : `${snapshot}\n`;
}

export function snapshotDiff(committed: string, actual: string): string | null {
  if (committed === actual) return null;
  const dir = mkdtempSync(join(tmpdir(), 'sellf-schema-diff-'));
  try {
    const a = join(dir, 'committed.sql');
    const b = join(dir, 'actual.sql');
    writeFileSync(a, committed);
    writeFileSync(b, actual);
    const result = spawnSync('diff', ['-u', '--label', 'supabase/schema.snapshot.sql (committed)', '--label', 'schema from migrations', a, b], { encoding: 'utf8' });
    return result.stdout || 'snapshots differ';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Own project id and ports (prefix + the last two digits of each port), same Postgres settings. */
export function rewriteConfigForSnapshot(config: string, projectId: string, portPrefix: string): string {
  return config
    .replace(/^project_id\s*=\s*".*"$/m, `project_id = "${projectId}"`)
    .replace(/^(\s*(?:\w+_)?port\s*=\s*)\d{3}(\d{2})\s*$/gm, `$1${portPrefix}$2`)
    .replace(/(127\.0\.0\.1|localhost):\d{3}(\d{2})/g, `$1:${portPrefix}$2`);
}

// ===== STACK (integration) =====

function run(cmd: string, args: string[], options: { cwd?: string; input?: string } = {}): string {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status ?? result.signal}):\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function supabaseBin(): string {
  return process.env.SUPABASE_BIN || 'supabase';
}

function cliVersion(): string {
  return run(supabaseBin(), ['--version']).trim().split('\n')[0].trim();
}

/** Schema parts of a running local database container (the throwaway stack, or the test stack in tests). */
export function captureSchema(container: string): Omit<SnapshotParts, 'cliVersion'> {
  // --no-privileges: privileges are the canonical records in the extras, not GRANT lines in grant order.
  const dump = run('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '--schema-only', '--no-privileges', ...DUMP_SCHEMAS.flatMap((s) => ['--schema', s])]);
  const extras = run('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: EXTRAS_SQL });
  const serverVersion = run('docker', ['exec', container, 'psql', '-X', '-tA', '-U', 'postgres', '-c', 'SHOW server_version']).trim();
  return { dump, extras, serverVersion };
}

export function buildSchemaFromMigrations(repoRoot: string): string {
  const version = cliVersion();
  if (version !== PINNED_SUPABASE_CLI) {
    throw new Error(
      `Supabase CLI ${version} found, the snapshot is built with ${PINNED_SUPABASE_CLI} (the CLI chooses the Postgres image). ` +
      `Run with SUPABASE_BIN pointing at ${PINNED_SUPABASE_CLI} (e.g. a downloaded binary), or bump PINNED_SUPABASE_CLI ` +
      'together with the workflows and refresh the snapshot.',
    );
  }
  const container = `supabase_db_${SNAPSHOT_PROJECT_ID}`;
  const existing = spawnSync('docker', ['ps', '-a', '--filter', `name=^${container}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (existing.status !== 0) throw new Error(`docker is not available: ${existing.stderr}`);
  if (existing.stdout.trim()) {
    throw new Error(`${container} already exists (another schema run, or a leftover). Stop it: supabase stop --no-backup --project-id ${SNAPSHOT_PROJECT_ID}`);
  }

  const work = mkdtempSync(join(tmpdir(), 'sellf-schema-'));
  const supabaseDir = join(work, 'supabase');
  mkdirSync(join(supabaseDir, 'migrations'), { recursive: true });
  try {
    const source = join(repoRoot, 'supabase');
    for (const file of readdirSync(join(source, 'migrations')).filter((f) => f.endsWith('.sql'))) {
      copyFileSync(join(source, 'migrations', file), join(supabaseDir, 'migrations', file));
    }
    if (existsSync(join(source, 'templates'))) cpSync(join(source, 'templates'), join(supabaseDir, 'templates'), { recursive: true });
    // No seed.sql: the snapshot is the schema the migrations alone produce.
    const config = readFileSync(join(source, 'config.toml'), 'utf8');
    writeFileSync(join(supabaseDir, 'config.toml'), rewriteConfigForSnapshot(config, SNAPSHOT_PROJECT_ID, SNAPSHOT_PORT_PREFIX));

    try {
      run(supabaseBin(), ['start', '--workdir', work, '-x', EXCLUDED_SERVICES]);
      return buildSnapshot({ cliVersion: version, ...captureSchema(container) });
    } finally {
      spawnSync(supabaseBin(), ['stop', '--no-backup', '--workdir', work], { encoding: 'utf8' });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== 'check' && mode !== 'update') {
    console.error('Usage: bun scripts/schema-snapshot.ts check|update');
    process.exit(2);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const snapshotPath = join(repoRoot, 'supabase', 'schema.snapshot.sql');
  const started = Date.now();
  let actual: string;
  try {
    actual = buildSchemaFromMigrations(repoRoot);
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(2);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (mode === 'update') {
    writeFileSync(snapshotPath, actual);
    console.log(`✓ supabase/schema.snapshot.sql written (${actual.split('\n').length} lines, ${seconds}s). Commit it with the migration.`);
    return;
  }

  const committed = existsSync(snapshotPath) ? readFileSync(snapshotPath, 'utf8') : '';
  const diff = snapshotDiff(committed, actual);
  if (diff === null) {
    console.log(`✓ Schema from migrations matches supabase/schema.snapshot.sql (${seconds}s).`);
    return;
  }
  const lines = diff.split('\n');
  console.error(lines.slice(0, DIFF_LINE_LIMIT).join('\n'));
  if (lines.length > DIFF_LINE_LIMIT) console.error(`… ${lines.length - DIFF_LINE_LIMIT} more diff lines`);
  console.error(
    `\n✖ The schema built from supabase/migrations differs from supabase/schema.snapshot.sql (${seconds}s).\n` +
    '  New migration: run `bun run schema:snapshot` in admin-panel and commit the snapshot with it.\n' +
    '  Consolidation: the consolidated files must produce the same schema; fix them, do not refresh the snapshot.',
  );
  process.exit(1);
}

if (import.meta.main) main();
