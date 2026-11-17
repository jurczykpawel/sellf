/**
 * Exercises the migration and completion blocks from upgrade.sh with local RPC fixtures.
 * @see admin-panel/scripts/upgrade.sh
 */
import { execFile } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const source = readFileSync(path.resolve(__dirname, '../../../scripts/upgrade.sh'), 'utf8');
const directories: string[] = [];

function block(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error(`Missing upgrade block: ${start}`);
  return source.slice(from, to);
}

interface MigrationFixture {
  version: string;
  result: string;
  httpError?: boolean;
}

async function runHarness(migrations: MigrationFixture[], applied: unknown = [], missingConfig = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-migration-report-'));
  directories.push(dir);
  const install = path.join(dir, 'install');
  const migrationDir = path.join(install, 'supabase/migrations');
  const bin = path.join(dir, 'bin');
  mkdirSync(migrationDir, { recursive: true });
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'scratch'));
  mkdirSync(path.join(dir, 'backup/.next/standalone/admin-panel'), { recursive: true });
  writeFileSync(path.join(dir, 'backup/.next/standalone/admin-panel/server.js'), 'previous version');
  writeFileSync(path.join(install, '.env.local'), missingConfig ? '' : 'SUPABASE_URL=http://fixture.invalid\nSUPABASE_SERVICE_ROLE_KEY=test-key\n');
  writeFileSync(path.join(dir, 'status.json'), JSON.stringify(applied));
  writeFileSync(path.join(dir, 'calls'), '');
  for (const name of ['argv', 'headers', 'private-headers']) writeFileSync(path.join(dir, name), '');
  for (const migration of migrations) {
    writeFileSync(path.join(migrationDir, `${migration.version}.sql`), 'SELECT 1;');
    writeFileSync(path.join(dir, `${migration.version}.result`), migration.result);
    if (migration.httpError) writeFileSync(path.join(dir, `${migration.version}.http-error`), '');
  }
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "$FIXTURE_DIR/argv"
url='' payload='' output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -H) if [[ "$2" == @* ]]; then f="\${2#@}"; cat "$f" >> "$FIXTURE_DIR/headers"; find "$f" -perm 600 >> "$FIXTURE_DIR/private-headers"; fi; shift ;;
    http*) url="$1" ;;
    --data-binary|-d) payload="$2"; shift ;;
    -o) output="$2"; shift ;;
  esac
  shift
done
code=200
if [[ "$url" == */get_migration_status ]]; then
  body="$FIXTURE_DIR/status.json"
else
  if [[ "$payload" == @* ]]; then payload=$(cat "\${payload#@}"); fi
  VERSION=$(printf '%s' "$payload" | jq -r '.migration_version')
  printf '%s\\n' "$VERSION" >> "$FIXTURE_DIR/calls"
  [ ! -f "$FIXTURE_DIR/$VERSION.http-error" ] || code=500
  body="$FIXTURE_DIR/$VERSION.result"
fi
if [ -n "$output" ]; then
  cat "$body" > "$output"
  printf '%s' "$code"
else
  [ "$code" = 200 ] || exit 22
  cat "$body"
fi
`, { mode: 0o755 });
  const harness = path.join(dir, 'harness.sh');
  writeFileSync(harness, `#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$FIXTURE_DIR/install"
EXTRACT_DIR="$INSTALL_DIR"
LOG_FILE="$FIXTURE_DIR/upgrade.log"
TMP_DIR="$FIXTURE_DIR/scratch"
BACKUP_DIR="$FIXTURE_DIR/backup"
TAG_NAME=v2026.10.0
HEALTH_OK=true
MIGRATION_RECHECK_SECONDS=0
log() { printf '%s\\n' "$*"; }
write_progress() { printf 'PROGRESS: %s %s\\n' "$1" "$3"; }
write_error() { printf 'WRITE_ERROR: %s\\n' "$1"; }
write_failure() { printf 'WRITE_ERROR: %s\\n' "$2"; }
${block('# installed-version:start', '# installed-version:end')}
${block('# failure-report:start', '# failure-report:end')}
pm2() { :; }
PM2_BIN=pm2
PM2_NAME=sellf-fixture
${block('# ===== STEP 4b: MIGRATION PREFLIGHT =====', '# ===== STEP 5: BACKUP =====')}
${block('# ===== STEP 8: RUN MIGRATIONS =====', '# ===== STEP 9: START PM2 =====')}
${block('if [ "$HEALTH_OK" = "true" ]; then', '# ===== FIREWALL CHECK =====')}
${block('# ===== CLEANUP =====', '\n}\nmain "$@"')}
`);
  const execution = await execFileAsync('bash', [harness], {
    env: { ...process.env, FIXTURE_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
  }).then(({ stdout }) => ({ stdout, code: 0 })).catch((error: { stdout: string; code: number }) => ({
    stdout: error.stdout, code: error.code,
  }));
  const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
  return { ...execution, calls: read('calls'), argv: read('argv'), headers: read('headers'), privateHeaders: read('private-headers') };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const first = '20260523130711_webhook_secret_whsec_prefix';
const second = '20260924000000_access_scope_tightening';
const third = '20261001000000_example';

describe('upgrade.sh migration reporting', () => {
  it('applies every pending migration in one RPC call and reports the count', async () => {
    const run = await runHarness([
      { version: first, result: 'should not be requested' },
      { version: second, result: 'should not be requested' },
      { version: third, result: '{"success":true,"skipped":false}' },
    ], [{ version: first }]);
    expect(run.calls).toBe(`${third}\n`);
    expect(run.stdout).toContain('Migrations complete: 2 applied, 1 already applied, 0 errors');
    expect(run.stdout).toContain('PROGRESS: done');
    expect(run.code).toBe(0);
  });

  it('passes the service-role key to curl only through a private header file, never as a process argument', async () => {
    const run = await runHarness([
      { version: first, result: 'should not be requested' },
      { version: third, result: '{"success":true,"skipped":false}' },
    ], [{ version: first }]);
    expect(run.code).toBe(0);
    expect(run.argv).not.toContain('test-key');
    expect(run.headers).toContain('apikey: test-key');
    expect(run.headers).toContain('Authorization: Bearer test-key');
    expect(run.privateHeaders.trim().split('\n').length).toBeGreaterThanOrEqual(2);
  });

  it('reports a failed batch with the database message and applies nothing', async () => {
    const run = await runHarness([
      { version: first, result: 'should not be requested' },
      { version: second, result: '{"success":false,"message":"Migration 20261001000000_example failed: relation \\"x\\" does not exist"}' },
    ]);
    expect(run.calls).toBe(`${second}\n`);
    expect(run.stdout).toContain('Migrations complete: 0 applied, 0 already applied, 1 errors');
    expect(run.stdout).toContain('WRITE_ERROR: Database migration failed: Migration 20261001000000_example failed: relation "x" does not exist.');
    expect(run.stdout).toContain('All 2 pending migrations of this release were rolled back together');
    expect(run.stdout).not.toContain('completed successfully');
    expect(run.code).toBe(1);
  });

  it('reports a reinstall with no newly applied migrations', async () => {
    const run = await runHarness([{ version: first, result: 'should not be requested' }], [{ version: first }]);
    expect(run.calls).toBe('');
    expect(run.stdout).toContain('Migrations complete: 0 applied, 1 already applied, 0 errors');
    expect(run.stdout).toContain('PROGRESS: done');
    expect(run.code).toBe(0);
  });

  it('treats a batch the database reports as already applied as a failure', async () => {
    const run = await runHarness([{ version: first, result: '{"success":true,"skipped":true,"message":"Already applied (concurrent)"}' }]);
    expect(run.stdout).toContain('Migrations complete: 0 applied, 0 already applied, 1 errors');
    expect(run.stdout).toContain('migration registry changed during the update');
    expect(run.code).toBe(1);
  });

  it('stops before any migration when the database records the timestamp under a different name', async () => {
    const run = await runHarness([
      { version: first, result: 'should not be requested' },
      { version: second, result: 'should not be requested' },
    ], [{ version: '20260523130711_webhook_secret_and_delivery_retry' }]);
    expect(run.calls).toBe('');
    expect(run.stdout).toContain('WRITE_ERROR: Migration 20260523130711 is recorded in the database as webhook_secret_and_delivery_retry, but this release names it webhook_secret_whsec_prefix.');
    expect(run.stdout).not.toContain('Migrations complete');
    expect(run.code).toBe(1);
  });

  it('recognizes a timestamp-only status entry', async () => {
    const run = await runHarness([{ version: first, result: 'should not be requested' }], [{ version: '20260523130711' }]);
    expect(run.calls).toBe('');
    expect(run.code).toBe(0);
  });

  it.each(['not JSON', '', 'null', '[]', '{}', '{"success":"true"}', '{"success":true}\nnot JSON'])(
    'counts an invalid RPC result as an error: %j', async (result) => {
      const run = await runHarness([{ version: first, result }]);
      expect(run.stdout).toContain('Migrations complete: 0 applied, 0 already applied, 1 errors');
      expect(run.stdout).toContain('WRITE_ERROR: Database migration failed:');
      expect(run.code).toBe(1);
    },
  );

  it('reports an HTTP error with the database message', async () => {
    const run = await runHarness([
      { version: first, result: 'should not be requested' },
      { version: second, result: '{"code":"42P01","details":null,"hint":null,"message":"Migration 20260523130711_webhook_secret_whsec_prefix failed: boom"}', httpError: true },
    ]);
    expect(run.calls).toBe(`${second}\n`);
    expect(run.stdout).toContain('WRITE_ERROR: Database migration failed: Migration 20260523130711_webhook_secret_whsec_prefix failed: boom.');
    expect(run.code).toBe(1);
  });
});

it('reports incomplete migration setup as a failed upgrade', async () => {
  const result = await runHarness([], [], true);
  expect(result.stdout).toContain('WRITE_ERROR:');
  expect(result.stdout).not.toContain('PROGRESS: done');
});
