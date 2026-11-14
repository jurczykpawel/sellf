/**
 * DB TEST: the updater applies all pending migrations in one transaction.
 * Runs the migration, swap, health and rollback steps of scripts/upgrade.sh
 * against the local Supabase stack's real apply_migration RPC.
 *
 * REQUIRES: an isolated local Supabase stack (SUPABASE_URL, service key,
 * SUPABASE_DB_CONTAINER). UPGRADE_SCRIPT_UNDER_TEST may point at another
 * upgrade.sh (e.g. a previous release) to compare behaviour.
 *
 * @see admin-panel/scripts/upgrade.sh (migration-batch block)
 * @see supabase/migrations/20260303000000_migration_rpc.sql
 */
import { execFile, execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const execute = promisify(execFile);
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const scriptPath = process.env.UPGRADE_SCRIPT_UNDER_TEST || path.resolve(__dirname, '../../../scripts/upgrade.sh');
const directories: string[] = [];
const cleanupSql: string[] = [];

function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8',
  }).trim();
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error(`Missing upgrade block: ${start}`);
  return source.slice(from, to);
}

async function registry(): Promise<string[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_migration_status`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { version: string }[]).map(entry => entry.version);
}

/** Three release migrations with fresh timestamps; `brokenSecond` makes the middle one fail. */
function releaseMigrations(brokenSecond: boolean) {
  const base = 20990000000000 + randomInt(1, 9_000_000) * 100;
  const suffix = `w251_${base}`;
  const tables = [`public.${suffix}_first`, `public.${suffix}_third`];
  const migrations = {
    [`${base + 1}_${suffix}_first`]: `CREATE TABLE ${tables[0]} (id integer);\nINSERT INTO ${tables[0]} VALUES (1);\n`,
    [`${base + 2}_${suffix}_second`]: brokenSecond
      ? `SELECT id FROM public.${suffix}_does_not_exist;\n`
      : `ALTER TABLE ${tables[0]} ADD COLUMN note text;`,
    [`${base + 3}_${suffix}_third`]: `-- trailing comment without a final newline\nCREATE TABLE ${tables[1]} (id integer) -- no semicolon`,
  };
  cleanupSql.push(`DROP TABLE IF EXISTS ${tables.join(', ')};`,
    `DELETE FROM supabase_migrations.schema_migrations WHERE version IN (${Object.keys(migrations).map(name => `'${name.slice(0, 14)}'`).join(', ')});`);
  return { migrations, tables };
}

async function runUpgrade(migrations: Record<string, string>) {
  const source = readFileSync(scriptPath, 'utf8');
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-migration-tx-'));
  directories.push(dir);
  const health = createServer((_, response) => response.end('healthy'));
  await new Promise<void>(resolve => health.listen(0, '127.0.0.1', resolve));
  const address = health.address();
  if (!address || typeof address === 'string') throw new Error('Missing health address');
  const install = path.join(dir, 'install');
  const release = path.join(dir, 'release');
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'scratch'));
  for (const [folder, code] of [[install, 'old-code'], [release, 'new-code']]) {
    mkdirSync(path.join(folder, '.next/standalone/admin-panel'), { recursive: true });
    mkdirSync(path.join(folder, 'supabase/migrations'), { recursive: true });
    writeFileSync(path.join(folder, '.next/standalone/admin-panel/server.js'), code);
    writeFileSync(path.join(folder, 'version.txt'), code === 'old-code' ? '2026.11.1\n' : '2026.11.2\n');
  }
  for (const [name, sql] of Object.entries(migrations)) writeFileSync(path.join(release, `supabase/migrations/${name}.sql`), sql);
  writeFileSync(path.join(install, '.env.local'), `SUPABASE_URL=${SUPABASE_URL}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}\nPORT=${address.port}\n`, { mode: 0o600 });
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'pm2'), `#!/bin/bash
if [ "$1" = start ]; then cat "$FIXTURE_DIR/install/.next/standalone/admin-panel/server.js" >> "$FIXTURE_DIR/started"; fi
`, { mode: 0o755 });
  writeFileSync(path.join(dir, 'harness.sh'), `#!/bin/bash
set -euo pipefail
INSTALL_DIR="$FIXTURE_DIR/install"
EXTRACT_DIR="$FIXTURE_DIR/release"
TMP_DIR="$FIXTURE_DIR/scratch"
PROGRESS_FILE="$FIXTURE_DIR/progress.json"
LOG_FILE="$FIXTURE_DIR/upgrade.log"
PM2_BIN="$FIXTURE_DIR/bin/pm2"
PM2_NAME=sellf-fixture
TAG_NAME=v2026.11.2
${between(source, '# ===== HELPERS =====', '# Stage 2 is this same script')}
${between(source, '# ===== STEP 4b: MIGRATION PREFLIGHT =====', '# ===== FIREWALL CHECK =====')}
`);
  try {
    const code = await execute('bash', [path.join(dir, 'harness.sh')], {
      env: { ...process.env, FIXTURE_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
    }).then(() => 0).catch((error: { code: number }) => error.code);
    const read = (name: string) => existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), 'utf8') : '';
    return { code, progress: JSON.parse(read('progress.json')), started: read('started'), log: read('upgrade.log') };
  } finally {
    await new Promise<void>(resolve => health.close(() => resolve()));
  }
}

const tableExists = (table: string) => psql(`SELECT to_regclass('${table}') IS NOT NULL;`) === 't';

afterAll(() => {
  if (cleanupSql.length && SUPABASE_URL && SERVICE_KEY) psql(cleanupSql.join('\n'));
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)('updater migrations in one transaction (real database)', () => {
  it('leaves registry and schema untouched when the second of three migrations fails', async () => {
    const { migrations, tables } = releaseMigrations(true);
    const names = Object.keys(migrations);
    const before = await registry();

    const run = await runUpgrade(migrations);

    expect(run.code).toBe(1);
    expect(await registry()).toEqual(before);
    for (const table of tables) expect(tableExists(table)).toBe(false);
    expect(run.started).toBe('old-code');
    expect(run.progress).toMatchObject({ step: 'failed', code: 'migration_failed', rollback: true, details: { migration: names[1] } });
    expect(run.progress.details.cause).toContain(`Migration ${names[1]} failed:`);
    expect(run.progress.details.cause).toContain('does not exist');
    expect(run.progress.message).toContain('All 3 pending migrations of this release were rolled back together');
    expect(run.progress.message).toContain('the shop is running the previous version (2026.11.1) again');
  });

  it('applies and records all three migrations together when they succeed', async () => {
    const { migrations, tables } = releaseMigrations(false);
    const names = Object.keys(migrations);

    const run = await runUpgrade(migrations);

    expect(run.code, run.log).toBe(0);
    expect(run.progress.step).toBe('done');
    expect(await registry()).toEqual(expect.arrayContaining(names));
    for (const table of tables) expect(tableExists(table)).toBe(true);
    expect(psql(`SELECT count(*) FROM ${tables[0]} WHERE note IS NULL;`)).toBe('1');
    expect(run.started).toBe('new-code');
  });
});
