import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const runner = readFileSync(resolve('scripts/run-api-tests.sh'), 'utf8');
const cleanup = readFileSync(resolve('scripts/kill-dev-server.sh'), 'utf8');
const vitestConfig = readFileSync(resolve('vitest.config.api.ts'), 'utf8');
const fullRunner = readFileSync(resolve('scripts/run-full-tests.sh'), 'utf8');
const playwrightRunner = readFileSync(resolve('scripts/run-pw.sh'), 'utf8');
const shardedRunner = readFileSync(resolve('scripts/run-pw-sharded.sh'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('API test runner contract', () => {
  it('bounds every readiness request so a stale server cannot hang the runner', () => {
    const curlCommands = runner.match(/^\s*if .*curl .*$/gm) ?? [];

    expect(curlCommands.length).toBeGreaterThan(0);
    for (const command of curlCommands) {
      expect(command).toContain('--connect-timeout');
      expect(command).toContain('--max-time');
    }
  });

  it('owns a fresh foreground server process and always cleans its test port', () => {
    expect(runner).not.toContain('nohup');
    expect(runner).toContain('scripts/kill-dev-server.sh "$PORT"');
    expect(runner).toContain("trap cleanup EXIT INT TERM");
  });

  it('lets cleanup target explicit ports without killing unrelated test servers', () => {
    expect(cleanup).toContain('PORTS=("$@")');
    expect(cleanup).toContain('if [ "${#PORTS[@]}" -eq 0 ]');
  });

  it('runs database-backed API files sequentially with Vitest 4 options', () => {
    expect(vitestConfig).toContain('fileParallelism: false');
    expect(vitestConfig).not.toContain('poolOptions');
  });

  it('uses one fail-fast orchestrator for ttt and tttt', () => {
    expect(packageJson.scripts.ttt).toBe('scripts/run-full-tests.sh');
    expect(packageJson.scripts.tttt).toBe('scripts/run-full-tests.sh --reset-db');
    expect(fullRunner).toContain('set -euo pipefail');
    expect(fullRunner).toContain('trap cleanup EXIT INT TERM');
  });

  it('preserves Playwright process failures even without reporter output', () => {
    expect(playwrightRunner).toContain('set -uo pipefail');
    expect(playwrightRunner).toContain('PW_STATUS=${PIPESTATUS[0]}');
    expect(playwrightRunner).toContain('trap cleanup EXIT INT TERM');
  });

  it('cleans the sharded server and temporary report on interruption', () => {
    expect(shardedRunner).toContain('trap cleanup EXIT INT TERM');
    expect(shardedRunner).toContain('scripts/kill-dev-server.sh 3777');
    expect(shardedRunner).not.toMatch(/kill \$\(lsof -ti:3777/);
  });

  it('records full failure details and counts summary totals instead of retries', () => {
    expect(shardedRunner).toContain("/^[[:space:]]*[0-9]+\\)[[:space:]]/{f=1}");
    expect(shardedRunner).toContain("/^[[:space:]]*[0-9]+ passed/{print $1; exit}");
    expect(shardedRunner).toContain("/^[[:space:]]*[0-9]+ failed/{print $1; exit}");
    expect(shardedRunner).not.toContain("grep -c '✘'");
  });

  it('waits until a killed port has no listener left instead of trusting a fixed sleep', () => {
    // A dead PID does not guarantee the kernel released the socket yet. The old
    // "kill, sleep 1, check the PID" logic let the caller start a new server while
    // the port was still briefly held, which Playwright's webServer step reports as
    // "port already in use" and aborts the whole shard with 0 tests executed.
    expect(cleanup).toMatch(/while .*lsof -tiTCP:"\$port" -sTCP:LISTEN/);
    expect(cleanup).toMatch(/deadline|DEADLINE/i);
  });

  it('preserves a shard log on disk instead of unconditionally deleting it', () => {
    // "rm -f "$_tmp"" must only run on the success path (inside the rc==0 branch),
    // never unconditionally right after computing pass/fail counts — that is what
    // destroyed the evidence for every past infra failure.
    expect(shardedRunner).toMatch(/if \[ "\$rc" != 0 \]; then[\s\S]*else\s*\n\s*rm -f "\$_tmp"/);
    expect(shardedRunner).toContain('test-runs/');
  });

  it('saves the failing shard log and prints its tail instead of losing the output', () => {
    expect(shardedRunner).toMatch(/cp\s+"\$_tmp"\s+"\$\w+"/);
    expect(shardedRunner).toContain('tail -40');
  });

  it('flags a shard that exited non-zero with zero tests executed as an infra failure', () => {
    expect(shardedRunner).toMatch(/INFRA_FAILED/);
    expect(shardedRunner.toUpperCase()).toContain('INFRA FAILURE');
  });

  it('frees the exchange-rate stub port along with the dev server between runs', () => {
    const stubPort = /FX_STUB_PORT = (\d+)/.exec(readFileSync(resolve('playwright.config.ts'), 'utf8'))?.[1];
    expect(stubPort).toBeDefined();
    for (const script of [shardedRunner, playwrightRunner, fullRunner]) {
      const cleanups = script.match(/kill-dev-server\.sh [^>|&\n]*/g) ?? [];
      const serverCleanups = cleanups.filter((c) => c.includes('3777'));
      expect(serverCleanups.length).toBeGreaterThan(0);
      for (const c of serverCleanups) expect(c.split(/\s+/)).toContain(stubPort);
    }
  });
});
