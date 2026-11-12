/** Real shell/HTTP regression for SQL transport and failed-upgrade code restoration.
 * @see admin-panel/scripts/upgrade.sh
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  healthFailure?: boolean;
  payloadFailure?: boolean;
}

async function runUpgrade(options: FixtureOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-streaming-'));
  directories.push(dir);
  const requests: Record<string, string>[] = [];
  const server = createServer(async (request, response) => {
    if (request.url?.endsWith('/get_migration_status')) {
      response.end(options.statusBody ?? '[]');
    } else if (request.url?.endsWith('/apply_migration')) {
      let body = '';
      for await (const chunk of request) body += chunk;
      if (body) requests.push(JSON.parse(body));
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
  const sql = options.sql ?? 'SELECT 1;\n\n';
  writeFileSync(path.join(release, 'supabase/migrations/20261110235900_fixture.sql'), sql);
  writeFileSync(path.join(install, '.env.local'), `SUPABASE_URL=http://127.0.0.1:${address.port}\nSUPABASE_SERVICE_ROLE_KEY=fixture-key\nPORT=${address.port}\n`);
  for (const command of ['jq', 'curl']) {
    const executable = execFileSync('which', [command], { encoding: 'utf8' }).trim();
    // Enforce Linux MAX_ARG_STRLEN on macOS too; still execute real jq/curl.
    writeFileSync(path.join(bin, command), `#!/bin/bash
for argument in "$@"; do
  if [ "\${#argument}" -ge 131072 ]; then echo 'Argument list too long' >&2; exit 126; fi
done
${command === 'jq' && options.payloadFailure ? 'for argument in "$@"; do [ "$argument" != "--rawfile" ] || exit 9; done' : ''}
exec ${JSON.stringify(executable)} "$@"
`, { mode: 0o755 });
  }
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'pm2'), `#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE_DIR/pm2.log"
if [ "$1" = start ]; then cat "$FIXTURE_DIR/install/.next/standalone/admin-panel/server.js" >> "$FIXTURE_DIR/started"; fi
`, { mode: 0o755 });
  const start = source.indexOf('# ===== STEP 5: BACKUP =====');
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
${source.slice(start, end)}
`);
  try {
    const result = await execute('bash', [path.join(dir, 'harness.sh')], {
      env: { ...process.env, FIXTURE_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
    }).then(({ stdout }) => ({ code: 0, stdout })).catch((error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }));
    const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
    return { ...result, requests, read, log: read('upgrade.log'), started: read('started') };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('upgrade migration safety', () => {
  it('delivers SQL larger than MAX_ARG_STRLEN with the historical checksum', async () => {
    const sql = `-- ${'x'.repeat(150000)}\nSELECT 'zażółć';\n\n`;
    const result = await runUpgrade({ sql });
    expect(result.code).toBe(0);
    expect(result.requests).toEqual([{
      migration_version: '20261110235900_fixture', migration_sql: sql.replace(/\n+$/, ''),
      content_checksum: createHash('sha256').update(sql.replace(/\n+$/, '')).digest('hex'),
    }]);
    expect(result.started).toBe('new-code');
  });

  it.each([
    { status: 400, body: '{"message":"missing relation","details":"full database error body"}' },
    { body: '{"success":false,"message":"SQL rejected","details":"full RPC error body"}' },
    { body: 'invalid JSON error body' },
    { statusBody: '{"message":"invalid migration status"}' },
    { statusBody: '{}\n[]' },
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
    if (options.payloadFailure || options.statusBody) expect(result.requests).toHaveLength(0);
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
