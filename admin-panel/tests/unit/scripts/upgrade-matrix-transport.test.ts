/** Exercises the PM2 matrix transport with the installed updater's curl contract. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const runner = readFileSync(path.resolve(__dirname, '../../upgrade-matrix/pm2-run.sh'), 'utf8');
const transport = runner.split("cat > /transport/curl <<'SH'\n")[1]?.split('\nSH\n')[0];
if (!transport) throw new Error('Missing PM2 curl transport');
const base = 'https://github.com/jurczykpawel/sellf/releases';
const tag = 'v2099.1.0';

function fixture(check: (request: (url: string, options?: string[]) => ReturnType<typeof spawnSync>, dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-matrix-transport-'));
  writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ tag_name: tag }));
  writeFileSync(path.join(dir, 'sellf-build.v2.manifest'), 'signed fixture bytes\n');
  writeFileSync(path.join(dir, 'curl'), transport!.replaceAll('/fixtures', dir)
    .replace('exec /usr/bin/curl "$@"', 'printf "upstream-called" >&2; exit 99'), { mode: 0o755 });
  try {
    check((url, options = []) => spawnSync('bash', [path.join(dir, 'curl'), '-sS', '--max-time', '1',
      '-D', path.join(dir, 'headers'), '-o', path.join(dir, 'body'), '-w', '%{http_code} %{redirect_url}',
      ...options, url], { encoding: 'utf8' }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('PM2 matrix GitHub transport', () => {
  it('returns the local release redirect, headers and empty response body', () => fixture((request, dir) => {
    const result = request(`${base}/latest`);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe(`302 ${base}/tag/${tag}`);
    expect(readFileSync(path.join(dir, 'headers'), 'utf8')).toContain(`Location: ${base}/tag/${tag}\r\n`);
    expect(readFileSync(path.join(dir, 'body'), 'utf8')).toBe('');
  }));

  it('returns the exact local asset with the final HTTP status after following redirects', () => fixture((request, dir) => {
    const result = request(`${base}/download/${tag}/sellf-build.v2.manifest`, ['-L', '--proto-redir', '=https']);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('200 ');
    expect(readFileSync(path.join(dir, 'headers'), 'utf8')).toContain('HTTP/2 200\r\n');
    expect(readFileSync(path.join(dir, 'body'), 'utf8')).toBe('signed fixture bytes\n');
  }));

  it('reports a missing asset as 404 so the updater can use its legacy fallback', () => fixture((request, dir) => {
    const result = request(`${base}/download/${tag}/sellf-build.v2.manifest.sig`);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('404 ');
    expect(readFileSync(path.join(dir, 'headers'), 'utf8')).toContain('HTTP/2 404\r\n');
  }));

  it.each([
    `${base}/download/v2026.11.0/sellf-build.v2.manifest`,
    `${base}/download/${tag}/../release.json`,
    'https://github.com/other/repo/releases/latest',
    'https://api.github.com/repos/jurczykpawel/sellf/releases/latest',
  ])('refuses unconfigured GitHub request %s without reaching upstream', url => fixture(request => {
    const result = request(url);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('upstream-called');
  }));

  it('keeps real curl for local health and database requests', () => fixture(request => {
    const result = request('http://localhost:3000/api/health');
    expect(result.status).toBe(99);
    expect(result.stderr).toContain('upstream-called');
  }));
});
