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
});
