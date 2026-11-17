/**
 * The demo reset calls the reset RPC with the service-role key and reports success or failure.
 * Runs scripts/demo-reset.sh against a local curl stand-in that records its arguments.
 * @see scripts/demo-reset.sh
 */
import { execFile } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = path.resolve(__dirname, '../../../../scripts/demo-reset.sh');
const directories: string[] = [];

async function runReset(status: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-demo-reset-'));
  directories.push(dir);
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  for (const name of ['argv', 'headers', 'private-headers']) writeFileSync(path.join(dir, name), '');
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$FIXTURE_DIR/argv"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -H ] && [[ "$2" == @* ]]; then f="\${2#@}"; cat "$f" >> "$FIXTURE_DIR/headers"; find "$f" -perm 600 >> "$FIXTURE_DIR/private-headers"; fi
  shift
done
printf '\\n%s' "$FIXTURE_STATUS"
`, { mode: 0o755 });
  const execution = await execFileAsync('bash', [script], {
    env: { PATH: `${bin}:${process.env.PATH}`, FIXTURE_DIR: dir, FIXTURE_STATUS: status,
      SUPABASE_URL: 'http://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'demo-service-key' },
  }).then(({ stdout }) => ({ stdout, code: 0 })).catch((error: { stdout: string; code: number }) => ({ stdout: error.stdout, code: error.code }));
  const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
  return { ...execution, argv: read('argv'), headers: read('headers'), privateHeaders: read('private-headers') };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('demo-reset.sh', () => {
  it('passes the service-role key to curl only through a private header file, never as a process argument', async () => {
    const run = await runReset('204');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Demo database reset completed successfully');
    expect(run.argv).toContain('http://fixture.invalid/rest/v1/rpc/demo_reset_data');
    expect(run.argv).not.toContain('demo-service-key');
    expect(run.headers).toContain('apikey: demo-service-key');
    expect(run.headers).toContain('Authorization: Bearer demo-service-key');
    expect(run.headers).toContain('Content-Profile: public');
    expect(run.privateHeaders.trim()).not.toBe('');
  });

  it('fails with the HTTP status when the reset is refused', async () => {
    const run = await runReset('401');
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('Reset failed (HTTP 401)');
  });
});
