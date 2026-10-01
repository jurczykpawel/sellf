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

async function runHarness(migrations: MigrationFixture[], applied: unknown = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-migration-report-'));
  directories.push(dir);
  const install = path.join(dir, 'install');
  const migrationDir = path.join(install, 'supabase/migrations');
  const bin = path.join(dir, 'bin');
  mkdirSync(migrationDir, { recursive: true });
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'scratch'));
  writeFileSync(path.join(install, '.env.local'), 'SUPABASE_URL=http://fixture.invalid\nSUPABASE_SERVICE_ROLE_KEY=test-key\n');
  writeFileSync(path.join(dir, 'status.json'), JSON.stringify(applied));
  writeFileSync(path.join(dir, 'calls'), '');
  for (const migration of migrations) {
    writeFileSync(path.join(migrationDir, `${migration.version}.sql`), 'SELECT 1;');
    writeFileSync(path.join(dir, `${migration.version}.result`), migration.result);
    if (migration.httpError) writeFileSync(path.join(dir, `${migration.version}.http-error`), '');
  }
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$2" == */get_migration_status ]]; then
  cat "$FIXTURE_DIR/status.json"
  exit 0
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-d' ]; then
    VERSION=$(printf '%s' "$2" | jq -r '.migration_version')
    printf '%s\\n' "$VERSION" >> "$FIXTURE_DIR/calls"
    [ ! -f "$FIXTURE_DIR/$VERSION.http-error" ] || exit 22
    cat "$FIXTURE_DIR/$VERSION.result"
    exit 0
  fi
  shift
done
exit 1
`, { mode: 0o755 });
  const harness = path.join(dir, 'harness.sh');
  writeFileSync(harness, `#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$FIXTURE_DIR/install"
LOG_FILE="$FIXTURE_DIR/upgrade.log"
TMP_DIR="$FIXTURE_DIR/scratch"
BACKUP_DIR="$FIXTURE_DIR/backup"
TAG_NAME=v2026.10.0
HEALTH_OK=true
log() { printf '%s\\n' "$*"; }
write_progress() { printf 'PROGRESS: %s %s\\n' "$1" "$3"; }
write_error() { printf 'WRITE_ERROR: %s\\n' "$1"; }
pm2() { :; }
${block('# ===== STEP 8: RUN MIGRATIONS =====', '# ===== STEP 9: START PM2 =====')}
${block('if [ "$HEALTH_OK" = "true" ]; then', '# ===== FIREWALL CHECK =====')}
${block('# ===== CLEANUP =====', '\n}\nmain "$@"')}
`);
  const execution = await execFileAsync('bash', [harness], {
    env: { ...process.env, FIXTURE_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
  }).then(({ stdout }) => ({ stdout, code: 0 })).catch((error: { stdout: string; code: number }) => ({
    stdout: error.stdout, code: error.code,
  }));
  return { ...execution, calls: readFileSync(path.join(dir, 'calls'), 'utf8') };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const first = '20260523130711_webhook_secret_whsec_prefix';
const second = '20260924000000_access_scope_tightening';
const third = '20261001000000_example';

describe('upgrade.sh migration reporting', () => {
  it('counts applied, already applied and failed RPC responses separately', async () => {
    const run = await runHarness([
      { version: first, result: '{"success":true,"skipped":true,"message":"Already applied"}' },
      { version: second, result: '{"success":true,"skipped":false}' },
      { version: third, result: '{"success":false,"skipped":true,"message":"Migration could not complete"}' },
    ]);
    expect(run.stdout).toContain('Migrations complete: 1 applied, 1 already applied, 1 errors');
    expect(run.stdout).toContain(`WARNING: Migration ${third} failed: Migration could not complete`);
    expect(run.stdout).toContain('WRITE_ERROR: Upgrade to v2026.10.0 finished with 1 migration errors. Check upgrade logs.');
    expect(run.stdout).not.toContain('completed successfully');
    expect(run.code).toBe(1);
  });

  it('reports a reinstall with no newly applied migrations', async () => {
    const run = await runHarness([{ version: first, result: '{"success":true,"skipped":true}' }]);
    expect(run.stdout).toContain('Migrations complete: 0 applied, 1 already applied, 0 errors');
    expect(run.stdout).toContain('PROGRESS: done');
    expect(run.code).toBe(0);
  });

  it('recognizes a recorded timestamp despite a different migration name', async () => {
    const run = await runHarness([{ version: first, result: 'should not be requested' }], [
      { version: '20260523130711_webhook_secret_and_delivery_retry' },
    ]);
    expect(run.calls).toBe('');
    expect(run.stdout).toContain('Migrations complete: 0 applied, 1 already applied, 0 errors');
    expect(run.code).toBe(0);
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
      expect(run.stdout).toContain(`WARNING: Migration ${first} failed:`);
      expect(run.code).toBe(1);
    },
  );

  it('continues through later migrations after an HTTP error and reports it at completion', async () => {
    const run = await runHarness([
      { version: first, result: '', httpError: true },
      { version: second, result: '{"success":true}' },
    ]);
    expect(run.calls).toContain(second);
    expect(run.stdout).toContain('Migrations complete: 1 applied, 0 already applied, 1 errors');
    expect(run.stdout).toContain('WRITE_ERROR: Upgrade');
    expect(run.code).toBe(1);
  });
});
