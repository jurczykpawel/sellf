/**
 * The maintenance spec turns one global switch on, so it runs in its own Playwright project after the
 * parallel ones. The standard regression (test:sharded, ttt, tttt) must still run it: after the other
 * shards, once, with --no-deps (its project depends on chromium + chromium-heavy, which already ran).
 * Runs the real runner scripts with npx/node/bun and the sub-runners replaced by argument recorders;
 * no browser, server or database is started.
 * @see scripts/run-pw-sharded.sh
 * @see scripts/run-full-tests.sh
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function recorder(file: string, log: string, label: string) {
  writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "${label} $*" >> "${log}"\necho "  1 passed"\n`);
  chmodSync(file, 0o755);
}

/** A copy of admin-panel/scripts with the real runners and everything they call replaced. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sellf-runner-'));
  dirs.push(root);
  const app = path.join(root, 'admin-panel');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(app, 'scripts'), { recursive: true });
  mkdirSync(bin);
  for (const script of ['run-pw-sharded.sh', 'run-full-tests.sh']) {
    copyFileSync(path.resolve('scripts', script), path.join(app, 'scripts', script));
    chmodSync(path.join(app, 'scripts', script), 0o755);
  }
  writeFileSync(path.join(app, 'scripts/kill-dev-server.sh'), '#!/usr/bin/env bash\nexit 0\n');
  for (const script of ['run-api-tests.sh', 'run-leads-tests.sh', 'run-pw.sh']) recorder(path.join(app, 'scripts', script), log, script);
  for (const tool of ['npx', 'node', 'bun']) recorder(path.join(bin, tool), log, tool);
  return { app, log, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } };
}

const playwrightCalls = (log: string) => readFileSync(log, 'utf8').trim().split('\n').filter(line => line.startsWith('npx playwright test'));

describe('maintenance spec in the standard regression @J655', () => {
  it('test:sharded runs the maintenance project once, after every other shard, without re-running its dependencies', () => {
    const { app, log, env } = fixture();
    execFileSync('bash', ['scripts/run-pw-sharded.sh', '2', '1'], { cwd: app, env, stdio: 'pipe' });
    const calls = playwrightCalls(log);
    expect(calls.map(call => call.match(/--project=(\S+)/)?.[1])).toEqual(['chromium-heavy', 'chromium', 'chromium', 'maintenance']);
    const maintenance = calls.filter(call => call.includes('--project=maintenance'));
    expect(maintenance).toHaveLength(1);
    expect(maintenance[0]).toContain('--no-deps');
    expect(calls.filter(call => call.includes('--no-deps'))).toEqual(maintenance);
  });

  it('ttt and tttt (run-full-tests.sh) run it as part of the sharded E2E step, before the rate-limiting suite', () => {
    const { app, log, env } = fixture();
    execFileSync('bash', ['scripts/run-full-tests.sh'], { cwd: app, env, stdio: 'pipe' });
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    const maintenance = lines.findIndex(line => line.startsWith('npx playwright test') && line.includes('--project=maintenance') && line.includes('--no-deps'));
    const lastChromium = lines.map((line, index) => (/--project=chromium(-heavy)? /.test(line) ? index : -1)).reduce((a, b) => Math.max(a, b));
    expect(maintenance).toBeGreaterThan(lastChromium);
    expect(maintenance).toBeLessThan(lines.findIndex(line => line.startsWith('run-pw.sh') && line.includes('--project=rate-limiting')));
  });

  it('a failing maintenance run fails the whole regression', () => {
    const { app, log, env } = fixture();
    writeFileSync(path.join(env.PATH.split(':')[0], 'npx'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "npx $*" >> "${log}"\ncase "$*" in *--project=maintenance*) echo "  1 failed"; exit 1;; esac\necho "  1 passed"\n`);
    let status = 0;
    try { execFileSync('bash', ['scripts/run-pw-sharded.sh', '1', '1'], { cwd: app, env, stdio: 'pipe' }); } catch (error) { status = (error as { status: number }).status; }
    expect(status).toBe(1);
  });
});
