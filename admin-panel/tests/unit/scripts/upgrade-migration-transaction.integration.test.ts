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
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
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

/**
 * Removes exactly one fixture's records, in one transaction. The schema is dropped only when
 * our own CREATE SCHEMA succeeded: that migration stamps it with the fixture's secret `owner`
 * comment right after creating it, so a failed CREATE (someone else's schema) leaves no stamp
 * and nothing is dropped. Registry rows go only when their name carries the fixture's UUID, so a
 * version that another run happened to draw is never deleted.
 */
function fixtureCleanupSql(token: string, owner: string, versions: string[]): string {
  return `BEGIN;
DO $cleanup$ BEGIN
  IF obj_description(to_regnamespace('upgrade_test_${token}')::oid, 'pg_namespace') = '${owner}' THEN
    DROP SCHEMA upgrade_test_${token} CASCADE;
  END IF;
END $cleanup$;
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN (${versions.map(version => `'${version}'`).join(', ')}) AND name LIKE 'upgrade\\_${token}\\_%';
COMMIT;`;
}

/**
 * Three release migrations with fresh timestamps; `brokenSecond` makes the middle one fail.
 * Each fixture owns a UUID: its schema (`upgrade_test_<uuid>`, created without IF NOT EXISTS so a
 * clash fails instead of reusing someone else's) and its registry names (`upgrade_<uuid>_*`).
 * Fixture tables never live in `public`: the Security Advisor lint (SA-0013, tables without RLS)
 * scans `public` in a parallel worker and must not see them.
 */
async function releaseMigrations(brokenSecond: boolean) {
  const token = randomUUID().replaceAll('-', '');
  const owner = randomUUID();
  const base = 20990000000000 + randomInt(1, 999_999_999) * 10;
  const suffix = `upgrade_${token}`;
  const schema = `upgrade_test_${token}`;
  const tables = [`${schema}.${suffix}_first`, `${schema}.${suffix}_third`];
  const migrations = {
    [`${base + 1}_${suffix}_first`]: `CREATE SCHEMA ${schema};\nCOMMENT ON SCHEMA ${schema} IS '${owner}';\nCREATE TABLE ${tables[0]} (id integer);\nINSERT INTO ${tables[0]} VALUES (1);\n`,
    [`${base + 2}_${suffix}_second`]: brokenSecond
      ? `SELECT id FROM ${schema}.${suffix}_does_not_exist;\n`
      : `ALTER TABLE ${tables[0]} ADD COLUMN note text;`,
    [`${base + 3}_${suffix}_third`]: `-- trailing comment without a final newline\nCREATE TABLE ${tables[1]} (id integer) -- no semicolon`,
  };
  const names = Object.keys(migrations);
  // A drawn version that is already registered would be skipped by apply_migration: fail loudly.
  const taken = (await registry()).filter(version => names.some(name => version.slice(0, 14) === name.slice(0, 14)));
  if (taken.length) throw new Error(`Fixture versions already registered: ${taken.join(', ')}`);
  cleanupSql.push(fixtureCleanupSql(token, owner, names.map(name => name.slice(0, 14))));
  return { migrations, names, tables, schema };
}

interface ProxyOptions {
  /** Close the apply_migration connection unanswered once the real call returned. */
  dropAfterCommit?: boolean;
  /** Replace the real apply_migration answer once the real call returned. */
  replyAfterCommit?: { status: number; body: string };
  /** Answer registry reads made after apply_migration with this body (HTTP 200). */
  registryAfterCommit?: string;
}

/** Forwards RPC calls to the real API, optionally replacing what the updater receives. */
async function startProxy({ dropAfterCommit, replyAfterCommit, registryAfterCommit }: ProxyOptions) {
  let applied = false;
  const proxy = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const upstream = await fetch(`${SUPABASE_URL}${request.url}`, {
      method: 'POST', body,
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    });
    const text = await upstream.text();
    if (request.url?.endsWith('/apply_migration')) {
      applied = true;
      if (dropAfterCommit) {
        request.socket.destroy();
        return;
      }
      if (replyAfterCommit) {
        response.writeHead(replyAfterCommit.status);
        response.end(replyAfterCommit.body);
        return;
      }
    }
    if (applied && registryAfterCommit !== undefined && request.url?.endsWith('/get_migration_status')) {
      response.end(registryAfterCommit);
      return;
    }
    response.writeHead(upstream.status);
    response.end(text);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy address');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => proxy.close(() => resolve())) };
}

async function runUpgrade(migrations: Record<string, string>, apiUrl = SUPABASE_URL) {
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
  writeFileSync(path.join(install, '.env.local'), `SUPABASE_URL=${apiUrl}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}\nPORT=${address.port}\n`, { mode: 0o600 });
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'pm2'), `#!/bin/bash
if [ "$1" = start ]; then cat "$FIXTURE_DIR/install/.next/standalone/admin-panel/server.js" >> "$FIXTURE_DIR/started"; fi
if [ "$1" = jlist ]; then echo '[]'; fi
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
      env: { ...process.env, FIXTURE_DIR: dir, PATH: `${bin}:${process.env.PATH}`, MIGRATION_RECHECK_SECONDS: '0' },
    }).then(() => 0).catch((error: { code: number }) => error.code);
    const read = (name: string) => existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), 'utf8') : '';
    return { code, progress: JSON.parse(read('progress.json')), started: read('started'), log: read('upgrade.log') };
  } finally {
    await new Promise<void>(resolve => health.close(() => resolve()));
  }
}

const tableExists = (table: string) => psql(`SELECT to_regclass('${table}') IS NOT NULL;`) === 't';
/** Tables of this fixture visible in `public` (without RLS) to the parallel Security Advisor lint (SA-0013). */
const publicTablesOf = (tables: string[]) => psql(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN (${tables.map(table => `'${table.split('.')[1]}'`).join(', ')});`);
const schemaExists = (schema: string) => psql(`SELECT count(*) FROM pg_namespace WHERE nspname = '${schema}';`) === '1';

// Drop each test's schema and registry rows right after it, not once at the end of the file.
afterEach(() => {
  if (cleanupSql.length && SUPABASE_URL && SERVICE_KEY) psql(cleanupSql.splice(0).join('\n'));
});

afterAll(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)('updater migrations in one transaction (real database)', () => {
  it('leaves registry and schema untouched when the second of three migrations fails', async () => {
    const { migrations, names, tables, schema } = await releaseMigrations(true);

    const run = await runUpgrade(migrations);

    expect(run.code).toBe(1);
    const after = await registry();
    for (const name of names) expect(after).not.toContain(name);
    expect(schemaExists(schema)).toBe(false);
    for (const table of tables) expect(tableExists(table)).toBe(false);
    expect(run.started).toBe('old-code');
    expect(run.progress).toMatchObject({ step: 'failed', code: 'migration_failed', rollback: true, details: { migration: names[1] } });
    expect(run.progress.details.cause).toContain(`Migration ${names[1]} failed:`);
    expect(run.progress.details.cause).toContain('does not exist');
    expect(run.progress.message).toContain('All 3 pending migrations of this release were rolled back together');
    expect(run.progress.message).toContain('the shop is running the previous version (2026.11.1) again');
  });

  it('cleanup removes only its own registry rows and schema, never what another run created', () => {
    const version = String(20990000000000 + randomInt(1, 999_999_999) * 10);
    const token = randomUUID().replaceAll('-', '');
    const foreignName = `upgrade_${randomUUID().replaceAll('-', '')}_first`;
    const foreignSchema = `upgrade_test_${token}`;
    psql(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${foreignName}');
CREATE SCHEMA ${foreignSchema};
COMMENT ON SCHEMA ${foreignSchema} IS '${randomUUID()}';`);
    try {
      psql(fixtureCleanupSql(token, randomUUID(), [version]));
      expect(psql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${version}' AND name = '${foreignName}';`)).toBe('1');
      expect(schemaExists(foreignSchema)).toBe(true);
    } finally {
      psql(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '${version}' AND name = '${foreignName}';
DROP SCHEMA IF EXISTS ${foreignSchema};`);
    }
  });

  it('applies and records all three migrations together when they succeed', async () => {
    const { migrations, names, tables } = await releaseMigrations(false);

    const run = await runUpgrade(migrations);

    expect(run.code, run.log).toBe(0);
    expect(run.progress.step).toBe('done');
    expect(await registry()).toEqual(expect.arrayContaining(names));
    for (const table of tables) expect(tableExists(table)).toBe(true);
    expect(publicTablesOf(tables)).toBe('0');
    expect(psql(`SELECT count(*) FROM ${tables[0]} WHERE note IS NULL;`)).toBe('1');
    expect(run.started).toBe('new-code');
  });

  it('starts the new version when the connection drops after COMMIT', async () => {
    const { migrations, tables } = await releaseMigrations(false);
    const proxy = await startProxy({ dropAfterCommit: true });
    try {
      const run = await runUpgrade(migrations, proxy.url);
      expect(run.code, run.log).toBe(0);
      expect(run.progress.step).toBe('done');
      expect(run.started).toBe('new-code');
      expect(await registry()).toEqual(expect.arrayContaining(Object.keys(migrations)));
      for (const table of tables) expect(tableExists(table)).toBe(true);
      expect(run.log).toContain('registry shows all 3 migrations applied');
    } finally {
      await proxy.close();
    }
  });

  it.each([
    ['a lost answer', { dropAfterCommit: true }],
    ['a gateway error with a database-like body', { replyAfterCommit: { status: 502, body: JSON.stringify({ code: 'GW_AFTER_COMMIT', details: null, hint: null, message: 'upstream closed' }) } }],
    ['success:false', { replyAfterCommit: { status: 200, body: '{"success":false,"message":"reported failure"}' } }],
  ] as const)('reports an unknown outcome and starts no code after COMMIT, %s and a malformed registry read', async (_, reply) => {
    const { migrations, tables } = await releaseMigrations(false);
    const proxy = await startProxy({ ...reply, registryAfterCommit: '{}' });
    try {
      const run = await runUpgrade(migrations, proxy.url);
      expect(run.code).toBe(1);
      expect(run.started).toBe('');
      expect(run.progress).toMatchObject({ step: 'failed', code: 'migration_state_unknown', rollback: false });
      expect(run.progress.message).not.toContain('as it was before the update');
      expect(await registry()).toEqual(expect.arrayContaining(Object.keys(migrations)));
      for (const table of tables) expect(tableExists(table)).toBe(true);
    } finally {
      await proxy.close();
    }
  });
});
