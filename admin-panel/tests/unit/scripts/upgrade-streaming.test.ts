/** Real shell/HTTP regression for SQL transport and failed-upgrade code restoration.
 * @see admin-panel/scripts/upgrade.sh
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const source = readFileSync(path.resolve(__dirname, '../../../scripts/upgrade.sh'), 'utf8');
const directories: string[] = [];

interface FixtureOptions {
  sql?: string;
  status?: number;
  body?: string;
  statusBody?: string;
  statusCode?: number;
  withoutJq?: boolean;
  healthFailure?: boolean;
  payloadFailure?: boolean;
  migrations?: Record<string, string>;
  installedMigrations?: string[];
  /** Close the apply_migration connection without any response (result unknown). */
  applyDrop?: boolean;
  /** Registry answer once apply_migration was called: 'all' release versions, or a raw status/body. */
  statusAfterApply?: 'all' | { code: number; body: string };
  /** Write .env.local values in double quotes, as dotenv allows. */
  quotedEnv?: boolean;
  /** curl exits with this code for apply_migration without sending the request. */
  applyCurlExit?: number;
}

async function runUpgrade(options: FixtureOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-streaming-'));
  directories.push(dir);
  const requests: Record<string, string>[] = [];
  let statusReadsAfterApply = 0;
  let statusReads = 0;
  const apiKeys = new Set<string>();
  const server = createServer(async (request, response) => {
    if (request.url?.includes('/rest/v1/rpc/')) apiKeys.add(String(request.headers.apikey));
    if (request.url?.endsWith('/get_migration_status')) {
      statusReads++;
      const after = requests.length > 0 ? options.statusAfterApply : undefined;
      if (after) statusReadsAfterApply++;
      if (after === 'all') {
        response.end(JSON.stringify(Object.keys(options.migrations ?? { '20261110235900_fixture': '' }).map(version => ({ version }))));
      } else if (after) {
        response.writeHead(after.code);
        response.end(after.body);
      } else {
        response.writeHead(options.statusCode ?? 200);
        response.end(options.statusBody ?? '[]');
      }
    } else if (request.url?.endsWith('/apply_migration')) {
      let body = '';
      for await (const chunk of request) body += chunk;
      if (body) requests.push(JSON.parse(body));
      if (options.applyDrop) {
        request.socket.destroy();
        return;
      }
      response.writeHead(options.status ?? 200);
      response.end(options.body ?? '{"success":true}');
    } else {
      if (options.healthFailure) response.writeHead(503);
      response.end('healthy');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const install = path.join(dir, 'install');
  const release = path.join(dir, 'release');
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'scratch'));
  for (const [folder, code] of [[install, 'old-code'], [release, 'new-code']]) {
    mkdirSync(path.join(folder, '.next/standalone/admin-panel'), { recursive: true });
    mkdirSync(path.join(folder, 'public'));
    mkdirSync(path.join(folder, 'supabase/migrations'), { recursive: true });
    mkdirSync(path.join(folder, 'scripts'));
    writeFileSync(path.join(folder, '.next/standalone/admin-panel/server.js'), code);
    writeFileSync(path.join(folder, 'public/asset.txt'), code);
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ version: code }));
    writeFileSync(path.join(folder, 'version.txt'), code);
    writeFileSync(path.join(folder, 'bun.lock'), code);
    writeFileSync(path.join(folder, 'scripts/upgrade.sh'), code);
  }
  const migrations = options.migrations ?? { '20261110235900_fixture': options.sql ?? 'SELECT 1;\n\n' };
  for (const [name, sql] of Object.entries(migrations)) {
    writeFileSync(path.join(release, `supabase/migrations/${name}.sql`), sql);
  }
  for (const name of options.installedMigrations ?? []) {
    writeFileSync(path.join(install, `supabase/migrations/${name}.sql`), 'SELECT 1;');
  }
  const quote = options.quotedEnv ? '"' : '';
  writeFileSync(path.join(install, '.env.local'), `SUPABASE_URL=${quote}http://127.0.0.1:${address.port}${quote}\nSUPABASE_SERVICE_ROLE_KEY=${quote}fixture-key${quote}\nPORT=${quote}${address.port}${quote}\n`);
  let systemPath = process.env.PATH ?? '';
  if (options.withoutJq) {
    const system = path.join(dir, 'system');
    mkdirSync(system);
    for (const folder of ['/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
      for (const name of readdirSync(folder)) {
        if (name !== 'jq' && !existsSync(path.join(system, name))) symlinkSync(path.join(folder, name), path.join(system, name));
      }
    }
    symlinkSync(process.execPath, path.join(system, 'node'));
    systemPath = system;
  }
  for (const command of options.withoutJq ? ['curl'] : ['jq', 'curl']) {
    const executable = execFileSync('which', [command], { encoding: 'utf8' }).trim();
    // Enforce Linux MAX_ARG_STRLEN on macOS too; still execute real jq/curl.
    writeFileSync(path.join(bin, command), `#!/bin/bash
for argument in "$@"; do
  if [ "\${#argument}" -ge 131072 ]; then echo 'Argument list too long' >&2; exit 126; fi
done
${command === 'jq' && options.payloadFailure ? 'for argument in "$@"; do [ "$argument" != "--rawfile" ] || exit 9; done' : ''}
${command === 'curl' && options.applyCurlExit ? `for argument in "$@"; do case "$argument" in */apply_migration) exit ${options.applyCurlExit} ;; esac; done` : ''}
exec ${JSON.stringify(executable)} "$@"
`, { mode: 0o755 });
  }
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'pm2'), `#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE_DIR/pm2.log"
if [ "$1" = start ]; then cat "$FIXTURE_DIR/install/.next/standalone/admin-panel/server.js" >> "$FIXTURE_DIR/started"; fi
`, { mode: 0o755 });
  const helperBlocks = ['installed-version', 'failure-report'].map(name => {
    const from = source.indexOf(`# ${name}:start`);
    return source.slice(from, source.indexOf(`# ${name}:end`, from));
  }).join('\n');
  const start = source.indexOf('# ===== STEP 4b: MIGRATION PREFLIGHT =====');
  const end = source.indexOf('# ===== FIREWALL CHECK =====');
  if (start < 0 || end <= start) throw new Error('Missing upgrade blocks');
  writeFileSync(path.join(dir, 'harness.sh'), `#!/bin/bash
set -euo pipefail
umask 077
INSTALL_DIR="$FIXTURE_DIR/install"
EXTRACT_DIR="$FIXTURE_DIR/release"
TMP_DIR="$FIXTURE_DIR/scratch"
LOG_FILE="$FIXTURE_DIR/upgrade.log"
PM2_BIN="$FIXTURE_DIR/bin/pm2"
PM2_NAME=sellf-fixture
TAG_NAME=v2026.11.0
log() { printf '%s\\n' "$*" >> "$LOG_FILE"; }
write_progress() { printf 'PROGRESS: %s\\n' "$1"; }
write_error() { printf 'ERROR: %s rollback=%s\\n' "$1" "\${2:-false}"; }
write_failure() { local r=false a; for a in "$@"; do [ "$a" != rollback ] || r=true; done; printf 'ERROR: %s rollback=%s code=%s\\n' "$2" "$r" "$1"; }
${helperBlocks}
${source.slice(start, end)}
`);
  try {
    const result = await execute('bash', [path.join(dir, 'harness.sh')], {
      env: { ...process.env, FIXTURE_DIR: dir, PATH: `${bin}:${systemPath}` },
    }).then(({ stdout }) => ({ code: 0, stdout })).catch((error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }));
    const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
    const optional = (name: string) => existsSync(path.join(dir, name)) ? read(name) : '';
    return {
      ...result, dir, requests, read, log: optional('upgrade.log'), started: optional('started'), pm2: optional('pm2.log'), statusReadsAfterApply, statusReads, apiKeys: [...apiKeys],
      installedMigrations: () => readdirSync(path.join(install, 'supabase/migrations')).sort(),
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('upgrade migration safety', () => {
  it('delivers SQL larger than MAX_ARG_STRLEN with a checksum of exactly the SQL sent', async () => {
    const sql = `-- ${'x'.repeat(150000)}\nSELECT 'zażółć';\n\n`;
    const result = await runUpgrade({ sql });
    expect(result.code).toBe(0);
    expect(result.requests).toHaveLength(1);
    const [request] = result.requests;
    expect(request.migration_version).toBe('20261110235900_fixture');
    expect(request.migration_sql).toContain(sql);
    expect(request.content_checksum).toBe(createHash('sha256').update(request.migration_sql).digest('hex'));
    expect(result.started).toBe('new-code');
  });

  it.each([
    { status: 400, body: '{"message":"missing relation","details":"full database error body"}' },
    { body: '{"success":false,"message":"SQL rejected","details":"full RPC error body"}' },
    { body: 'invalid JSON error body' },
    { payloadFailure: true },
  ])('restores old code without starting the failed release: %j', async options => {
    const result = await runUpgrade(options);
    expect(result.code).toBe(1);
    expect(result.started).toBe('old-code');
    expect(result.read('install/package.json')).toBe(JSON.stringify({ version: 'old-code' }));
    expect(result.read('install/version.txt')).toBe('old-code');
    expect(result.read('install/bun.lock')).toBe('old-code');
    expect(result.read('install/scripts/upgrade.sh')).toBe('old-code');
    expect(result.read('install/public/asset.txt')).toBe('old-code');
    expect(result.stdout).toContain('rollback=true');
    expect(result.stdout).not.toContain('PROGRESS: done');
    if (options.body) expect(result.log).toContain(options.body);
    if (options.payloadFailure) expect(result.requests).toHaveLength(0);
    if (options.body?.includes('"message"')) expect(result.stdout).toMatch(/ERROR: Database migration failed: (missing relation|SQL rejected)\./);
  });

  it('restores the same code and version metadata after a health-check failure', async () => {
    const result = await runUpgrade({ healthFailure: true });
    expect(result.code).toBe(1);
    expect(result.started).toBe('new-codeold-code');
    expect(result.read('install/version.txt')).toBe('old-code');
    expect(result.stdout).toContain('health check timeout');
    expect(result.stdout).toContain('rollback=true');
  });
});

describe('upgrade migration set', () => {
  const stale = '20261110235901_release_2026_11_0_pricing';
  const releaseMigrations = {
    '20261110235900_release_2026_11_0_storefront_core': 'SELECT 1;',
    '20261110235901_release_2026_11_0_storefront_templates': 'SELECT 2;',
  };

  it('applies only the release files and removes files left by an earlier release', async () => {
    const result = await runUpgrade({
      migrations: releaseMigrations,
      installedMigrations: [stale, '20261110235800_left_over'],
    });
    expect(result.code).toBe(0);
    expect(result.requests.map(request => request.migration_version)).toEqual(['20261110235901_release_2026_11_0_storefront_templates']);
    expect(result.requests[0].migration_sql).toContain('SELECT 1;');
    expect(result.requests[0].migration_sql).toContain('SELECT 2;');
    expect(result.requests[0].migration_sql).toContain("VALUES ('20261110235900', 'release_2026_11_0_storefront_core')");
    expect(result.requests[0].migration_sql).not.toContain('left_over');
    expect(result.installedMigrations()).toEqual(Object.keys(releaseMigrations).map(name => `${name}.sql`));
    expect(result.started).toBe('new-code');
  });

  it('stops before the database and the running installation when a timestamp repeats', async () => {
    const result = await runUpgrade({
      migrations: { ...releaseMigrations, [stale]: 'SELECT 3;' },
      installedMigrations: ['20261110235800_left_over'],
    });
    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(0);
    expect(result.pm2).toBe('');
    expect(result.stdout).toContain('20261110235901');
    expect(result.stdout).toContain('Database untouched');
    expect(result.stdout).not.toContain('PROGRESS: backing_up');
    expect(result.installedMigrations()).toEqual(['20261110235800_left_over.sql']);
    expect(result.read('install/version.txt')).toBe('old-code');
  });

  it('stops before the database when the database records a release timestamp under another name', async () => {
    const result = await runUpgrade({
      migrations: releaseMigrations,
      statusBody: JSON.stringify([{ version: '20261110235900_release_2026_11_0_storefront_core' }, { version: stale }]),
    });
    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(0);
    expect(result.pm2).toBe('');
    expect(result.stdout).toContain(
      'ERROR: Migration 20261110235901 is recorded in the database as release_2026_11_0_pricing, '
      + 'but this release names it release_2026_11_0_storefront_templates. '
      + 'Database untouched; restore the database from the backup taken before the failed upgrade. Nothing was changed;',
    );
    expect(result.stdout).toContain('rollback=false code=migration_preflight');
    expect(result.read('install/version.txt')).toBe('old-code');
  });

  it('applies the eight 2026.11 migrations to a database at 2026.10.6', async () => {
    const all = readdirSync(path.resolve(__dirname, '../../../../supabase/migrations'))
      .filter(name => name.endsWith('.sql')).map(name => name.slice(0, -4)).sort();
    const added = all.filter(name => name.startsWith('202611102359'));
    expect(added).toHaveLength(8);
    const result = await runUpgrade({
      migrations: Object.fromEntries(all.map(name => [name, 'SELECT 1;'])),
      statusBody: JSON.stringify(all.filter(name => !added.includes(name)).map(version => ({ version }))),
    });
    expect(result.code).toBe(0);
    expect(result.requests.map(request => request.migration_version)).toEqual([added[added.length - 1]]);
    for (const name of added.slice(0, -1)) {
      expect(result.requests[0].migration_sql).toContain(`VALUES ('${name.slice(0, 14)}', '${name.slice(15)}')`);
    }
    expect(result.requests[0].migration_sql.match(/^DO \$/gm)).toHaveLength(8);
  });
});

describe('upgrade migration status preflight', () => {
  it.each([
    { statusBody: '{"message":"invalid migration status"}' },
    { statusBody: '{}\n[]' },
    { statusBody: '' },
    { statusBody: 'null' },
    { statusBody: '[{"version":1}]' },
    { statusCode: 503, statusBody: 'unavailable' },
    { withoutJq: true },
  ])('stops before backup, PM2 and file changes when the registry cannot be checked: %j', async options => {
    const result = await runUpgrade(options);
    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(0);
    expect(result.pm2).toBe('');
    expect(result.stdout).not.toContain('PROGRESS: backing_up');
    expect(result.stdout).toContain('Database untouched');
    expect(result.stdout).toContain('rollback=false');
    expect(result.read('install/version.txt')).toBe('old-code');
    expect(existsSync(path.join(result.dir, 'install/.backup'))).toBe(false);
  });
});

describe('unknown migration outcome', () => {
  it('starts the new version when the response was lost but the registry shows every migration applied', async () => {
    const result = await runUpgrade({ applyDrop: true, statusAfterApply: 'all' });
    expect(result.code).toBe(0);
    expect(result.started).toBe('new-code');
    expect(result.stdout).toContain('PROGRESS: done');
    expect(result.stdout).not.toContain('rolled back');
    expect(result.log).toContain('registry shows all 1 migrations applied');
  });

  it('restores the previous code only after the registry confirms none was applied, read twice', async () => {
    const result = await runUpgrade({ applyDrop: true });
    expect(result.code).toBe(1);
    expect(result.started).toBe('old-code');
    expect(result.stdout).toContain('rolled back together');
    expect(result.log).toMatch(/registry shows none of the 1 migrations[\s\S]*registry shows none of the 1 migrations/);
  });

  it.each([
    ['unreadable', { code: 503, body: 'unavailable' }, 'could not be read'],
    ['partial', { code: 200, body: JSON.stringify([{ version: '20261110235900_release_2026_11_0_storefront_core' }]) }, 'shows 1 of 2'],
  ] as const)('leaves the application stopped when the registry is %s', async (_, statusAfterApply, registryText) => {
    const result = await runUpgrade({
      applyDrop: true, statusAfterApply,
      migrations: { '20261110235900_release_2026_11_0_storefront_core': 'SELECT 1;', '20261110235901_release_2026_11_0_storefront_templates': 'SELECT 2;' },
    });
    expect(result.code).toBe(1);
    expect(result.started).toBe('');
    expect(result.stdout).toContain('code=migration_state_unknown');
    expect(result.stdout).toContain(registryText);
    expect(result.stdout).toContain('The application was left stopped');
    expect(result.stdout).not.toContain('Nothing was changed');
    expect(result.stdout).not.toContain('as it was before the update');
    expect(result.stdout).toContain('rollback=false');
  });
});

describe('migration outcome after the request was sent', () => {
  const twoMigrations = {
    '20261110235900_release_2026_11_0_storefront_core': 'SELECT 1;',
    '20261110235901_release_2026_11_0_storefront_templates': 'SELECT 2;',
  };
  const gatewayError = JSON.stringify({ code: 'GW_AFTER_COMMIT', details: null, hint: null, message: 'upstream closed' });

  function expectUnknown(result: Awaited<ReturnType<typeof runUpgrade>>) {
    expect(result.code).toBe(1);
    expect(result.started).toBe('');
    expect(result.stdout).toContain('code=migration_state_unknown');
    expect(result.stdout).toContain('could not be read');
    expect(result.stdout).toContain('rollback=false');
    expect(result.stdout).not.toContain('as it was before the update');
    expect(result.stdout).not.toContain('rolled back together');
  }

  it.each([
    ['empty object', { code: 200, body: '{}' }],
    ['object', { code: 200, body: '{"versions":[]}' }],
    ['HTML page', { code: 200, body: '<html><body>Bad gateway</body></html>' }],
    ['empty body', { code: 200, body: '' }],
    ['success:false', { code: 200, body: '{"success":false,"message":"nope"}' }],
    ['gateway error with a database-like body', { code: 502, body: gatewayError }],
    ['entry without a version', { code: 200, body: '[{}]' }],
    ['numeric version', { code: 200, body: '[{"version":20261110235900}]' }],
    ['version that is not a timestamp', { code: 200, body: '[{"version":"latest"}]' }],
    ['two documents', { code: 200, body: '[]\n[]' }],
  ] as const)('a lost response with a malformed registry read (%s) is unknown and starts no code', async (_, statusAfterApply) => {
    expectUnknown(await runUpgrade({ applyDrop: true, statusAfterApply, migrations: twoMigrations }));
  });

  it.each([
    ['gateway error with a database-like body', { status: 502, body: gatewayError }],
    ['success:false', { status: 200, body: '{"success":false,"message":"reported failure"}' }],
    ['database error', { status: 400, body: JSON.stringify({ code: '42P01', details: null, hint: null, message: 'boom' }) }],
  ] as const)('after a sent request answered with %s', async (_, reply) => {
    expectUnknown(await runUpgrade({ ...reply, statusAfterApply: { code: 200, body: '{}' }, migrations: twoMigrations }));
    const applied = await runUpgrade({ ...reply, statusAfterApply: 'all', migrations: twoMigrations });
    expect(applied.code, applied.log).toBe(0);
    expect(applied.started).toBe('new-code');
    expect(applied.stdout).toContain('PROGRESS: done');
  });

  it.each([6, 7])('a request that was never sent (curl exit %i) restores the previous code without asking the registry', async exit => {
    const result = await runUpgrade({ applyCurlExit: exit });
    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(0);
    expect(result.statusReads).toBe(1);
    expect(result.started).toBe('old-code');
    expect(result.stdout).toContain(`curl exit ${exit}`);
    expect(result.stdout).toContain('rollback=true');
  });
});

it('reads quoted .env.local values the way dotenv does', async () => {
  const result = await runUpgrade({ quotedEnv: true });
  expect(result.code, result.log).toBe(0);
  expect(result.requests).toHaveLength(1);
  expect(result.apiKeys).toEqual(['fixture-key']);
  expect(result.started).toBe('new-code');
  expect(result.stdout).toContain('PROGRESS: done');
});
