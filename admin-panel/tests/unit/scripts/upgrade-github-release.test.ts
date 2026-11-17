/**
 * Release lookup and download failures of the installed updater, run end to end
 * against a local stand-in for github.com. No request may reach api.github.com.
 * @see admin-panel/scripts/upgrade.sh
 */
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const source = readFileSync(path.resolve(__dirname, '../../../scripts/upgrade.sh'), 'utf8');
const REPO_PATH = '/jurczykpawel/sellf';
const TAG = 'v2026.11.2';
let keyDir = '';
let publicKey = '';

beforeAll(() => {
  keyDir = mkdtempSync(path.join(tmpdir(), 'sellf-gh-key-'));
  execFileSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', path.join(keyDir, 'key.pem')]);
  publicKey = execFileSync('openssl', ['pkey', '-in', path.join(keyDir, 'key.pem'), '-pubout'], { encoding: 'utf8' }).trim();
});
afterAll(() => rmSync(keyDir, { recursive: true, force: true }));

function signed(content: string): Buffer {
  const file = path.join(keyDir, `${randomUUID()}.txt`);
  writeFileSync(file, content);
  return execFileSync('openssl', ['pkeyutl', '-sign', '-inkey', path.join(keyDir, 'key.pem'), '-rawin', '-in', file]);
}

type Route = (response: ServerResponse) => void;
const ok = (body: string | Buffer): Route => response => { response.writeHead(200); response.end(body); };
const status = (code: number, body = 'not found', headers: Record<string, string> = {}): Route => response => {
  response.writeHead(code, headers);
  response.end(body);
};

interface Scenario {
  latest?: Route;
  assets?: Record<string, Route>;
  networkDown?: boolean;
}

function v2Assets(): Record<string, Route> {
  const manifest = `version=${TAG.slice(1)}\nsha256=${'a'.repeat(64)}\nmin_updater_version=1\n`;
  return { 'sellf-build.v2.manifest': ok(manifest), 'sellf-build.v2.manifest.sig': ok(signed(manifest)) };
}

async function runUpdater(scenario: Scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-gh-'));
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? '';
    requests.push(url);
    if (url === `${REPO_PATH}/releases/latest`) {
      (scenario.latest ?? (r => { r.writeHead(302, { Location: `https://github.com${REPO_PATH}/releases/tag/${TAG}` }); r.end(); }))(response);
      return;
    }
    const prefix = `${REPO_PATH}/releases/download/${TAG}/`;
    const route = url.startsWith(prefix) ? scenario.assets?.[url.slice(prefix.length)] : undefined;
    (route ?? status(404))(response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const port = scenario.networkDown ? 9 : address.port;
  const install = path.join(dir, 'stack/admin-panel');
  const runtime = path.join(dir, 'runtime');
  const bin = path.join(dir, 'bin');
  for (const folder of [path.join(install, '.next/standalone'), runtime, bin, path.join(install, 'scripts')]) mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(install, 'version.txt'), '2026.10.6\n');
  writeFileSync(path.join(bin, 'pm2'), '#!/bin/bash\n[ "$1" != describe ] || exit 1\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'flock'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const realCurl = execFileSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).trim();
  writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
args=()
for arg in "$@"; do
  case "$arg" in
    https://api.github.com/*) printf '%s\\n' "$arg" >> "$FIXTURE/api-calls"; exit 22 ;;
    https://github.com/*) arg="http://127.0.0.1:${port}\${arg#https://github.com}" ;;
  esac
  args+=("$arg")
done
exec ${JSON.stringify(realCurl)} "\${args[@]}"
`, { mode: 0o755 });
  let script = source.replace(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/, publicKey);
  const start = script.indexOf('# runtime-dir:start');
  const end = script.indexOf('# runtime-dir:end', start);
  script = `${script.slice(0, start)}RUNTIME_DIR=${JSON.stringify(runtime)}\n${script.slice(end)}`;
  const scriptPath = path.join(install, 'scripts/upgrade.sh');
  writeFileSync(scriptPath, script);
  const token = randomUUID();
  try {
    const result = await execute('bash', [scriptPath, token, install], {
      env: { ...process.env, FIXTURE: dir, PATH: `${bin}:${process.env.PATH}`, PM2_NAME: 'sellf-fixture' },
    }).then(() => 0).catch((error: { code: number }) => error.code);
    const progress = JSON.parse(readFileSync(path.join(runtime, `sellf-upgrade-${token}.json`), 'utf8'));
    let apiCalls = '';
    try { apiCalls = readFileSync(path.join(dir, 'api-calls'), 'utf8'); } catch { /* none */ }
    return { exitCode: result, progress, requests, apiCalls };
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('updater release lookup without api.github.com', () => {
  it('leaves a stable installation unchanged when latest redirects to rc', async () => {
    const run = await runUpdater({ latest: status(302, '', { Location: `https://github.com${REPO_PATH}/releases/tag/v2026.11.2-rc.1` }) });
    expect(run.exitCode).toBe(1);
    expect(run.progress).toMatchObject({ code: 'release_lookup_invalid', details: { installed_version: '2026.10.6' } });
    expect(run.requests).toEqual([`${REPO_PATH}/releases/latest`]);
  });

  it('reads the latest tag from the github.com redirect and downloads assets by tag', async () => {
    const run = await runUpdater({ assets: v2Assets() });
    expect(run.apiCalls).toBe('');
    expect(run.requests).toEqual([
      `${REPO_PATH}/releases/latest`,
      `${REPO_PATH}/releases/download/${TAG}/sellf-build.v2.manifest`,
      `${REPO_PATH}/releases/download/${TAG}/sellf-build.v2.manifest.sig`,
      `${REPO_PATH}/releases/download/${TAG}/sellf-build.tar.gz`,
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.progress).toMatchObject({
      step: 'failed', code: 'release_asset_missing',
      details: { http_status: 404, asset: 'sellf-build.tar.gz', installed_version: '2026.10.6' },
    });
    expect(run.progress.message).toContain('sellf-build.tar.gz');
    expect(run.progress.message).toContain('Nothing was changed; the shop is still running version 2026.10.6.');
  });

  it('uses the legacy pair only when the release has neither v2 file', async () => {
    const manifest = `version=${TAG.slice(1)}\nsha256=${'a'.repeat(64)}\n`;
    const run = await runUpdater({ assets: { 'sellf-build.manifest': ok(manifest), 'sellf-build.manifest.sig': ok(signed(manifest)) } });
    expect(run.requests).toContain(`${REPO_PATH}/releases/download/${TAG}/sellf-build.manifest.sig`);
    expect(run.progress.details.asset).toBe('sellf-build.tar.gz');
  });

  it('refuses an incomplete v2 pair instead of falling back to the legacy pair', async () => {
    const assets = v2Assets();
    delete assets['sellf-build.v2.manifest.sig'];
    const run = await runUpdater({ assets: { ...assets, 'sellf-build.manifest': ok('x'), 'sellf-build.manifest.sig': ok('x') } });
    expect(run.requests.some(url => url.endsWith('/sellf-build.manifest'))).toBe(false);
    expect(run.progress).toMatchObject({ code: 'release_asset_missing', details: { asset: 'sellf-build.v2.manifest.sig' } });
  });

  it('shows the GitHub message, HTTP status and reset time when GitHub refuses', async () => {
    const reset = Math.floor(Date.UTC(2026, 10, 12, 14, 27, 0) / 1000);
    const run = await runUpdater({
      latest: status(429, '{"message":"API rate limit exceeded for 203.0.113.7.","documentation_url":"https://docs.github.com"}', {
        'Content-Type': 'application/json', 'x-ratelimit-reset': String(reset),
      }),
    });
    expect(run.exitCode).toBe(1);
    expect(run.progress).toMatchObject({
      step: 'failed', code: 'github_http',
      details: { http_status: 429, github_message: 'API rate limit exceeded for 203.0.113.7.', retry_at: '2026-11-12T14:27:00Z', installed_version: '2026.10.6' },
    });
    expect(run.progress.message).toContain('HTTP 429');
    expect(run.progress.message).toContain('API rate limit exceeded for 203.0.113.7.');
    expect(run.progress.message).toContain('Nothing was changed; the shop is still running version 2026.10.6.');
    expect(run.progress.message).toContain('Try again after 2026-11-12 14:27 UTC.');
  });

  it('turns retry-after seconds into a retry time', async () => {
    const before = Date.now();
    const run = await runUpdater({ latest: status(503, 'busy', { 'Retry-After': '120' }) });
    expect(run.progress.code).toBe('github_http');
    const retryAt = Date.parse(run.progress.details.retry_at);
    expect(retryAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + 119000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 121000);
  });

  it('reports a network failure separately', async () => {
    const run = await runUpdater({ networkDown: true });
    expect(run.progress).toMatchObject({ step: 'failed', code: 'github_unreachable', details: { installed_version: '2026.10.6' } });
    expect(run.progress.message).toContain('Could not connect to GitHub');
    expect(run.progress.message).toContain('Nothing was changed; the shop is still running version 2026.10.6.');
  });

  it('reports a wrong signature separately', async () => {
    const assets = v2Assets();
    assets['sellf-build.v2.manifest.sig'] = ok(Buffer.alloc(64, 1));
    const run = await runUpdater({ assets });
    expect(run.progress).toMatchObject({ step: 'failed', code: 'signature_invalid', details: { installed_version: '2026.10.6' } });
    expect(run.progress.message).toContain('Nothing was changed; the shop is still running version 2026.10.6.');
    expect(run.requests.some(url => url.endsWith('.tar.gz'))).toBe(false);
  });
});
