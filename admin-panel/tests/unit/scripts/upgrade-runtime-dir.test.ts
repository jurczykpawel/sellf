import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/upgrade.sh');
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

/**
 * L16 — lock/log/progress files used to live directly under the
 * world-writable /tmp with a predictable name. upgrade.sh now prefers a
 * private /run/sellf (only root can create anything under /run at all,
 * matching this script's own root assumption), falling back to /tmp only
 * if /run/sellf can't be created. Extract that resolution verbatim and
 * run it for real against a faked `mkdir` so both branches are proven,
 * not just read.
 */
function extractBlock(startMarker: string, endMarker: string): string {
  const start = SCRIPT_SOURCE.indexOf(startMarker);
  const end = SCRIPT_SOURCE.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find block between "${startMarker}" and "${endMarker}" in upgrade.sh`);
  }
  return SCRIPT_SOURCE.slice(start + startMarker.length, end);
}

const RUNTIME_DIR_BLOCK = extractBlock(
  '# runtime-dir:start — extracted verbatim by tests/unit/scripts/upgrade-runtime-dir.test.ts',
  '# runtime-dir:end'
);

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'sellf-runtime-dir-harness-'));
  const harness = `#!/usr/bin/env bash
set -euo pipefail
${RUNTIME_DIR_BLOCK}
echo "$RUNTIME_DIR"
`;
  writeFileSync(path.join(workDir, 'harness.sh'), harness);
  chmodSync(path.join(workDir, 'harness.sh'), 0o755);
});

/** Fake `mkdir`/`id` binaries on PATH so the harness never touches the real filesystem or depends on the test runner's actual uid. */
function fakeBin(dir: string, name: string, exitCode: number, stdout = ''): void {
  const script = `#!/usr/bin/env bash\n${stdout ? `echo '${stdout}'\n` : ''}exit ${exitCode}\n`;
  writeFileSync(path.join(dir, name), script);
  chmodSync(path.join(dir, name), 0o755);
}

describe('upgrade.sh runtime dir resolution (extracted verbatim from scripts/upgrade.sh)', () => {
  it('uses /run/sellf when running as root and mkdir succeeds', async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), 'sellf-fake-bin-'));
    fakeBin(binDir, 'id', 0, '0');
    fakeBin(binDir, 'mkdir', 0);

    const { stdout } = await execFileAsync('bash', [path.join(workDir, 'harness.sh')], {
      env: { PATH: `${binDir}:${process.env.PATH}` },
    });

    expect(stdout.trim()).toBe('/run/sellf');
  });

  it('falls back to /tmp when /run/sellf cannot be created even as root (e.g. /run unavailable)', async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), 'sellf-fake-bin-'));
    fakeBin(binDir, 'id', 0, '0');
    fakeBin(binDir, 'mkdir', 1);

    const { stdout } = await execFileAsync('bash', [path.join(workDir, 'harness.sh')], {
      env: { PATH: `${binDir}:${process.env.PATH}` },
    });

    expect(stdout.trim()).toBe('/tmp');
  });

  it('falls back to /tmp when not running as root, even if mkdir would have succeeded', async () => {
    // Regression guard: `mkdir -p` succeeds as a no-op against a directory
    // that already exists regardless of who owns it, so without the uid
    // check a non-root process could "succeed" against a stale root-owned
    // /run/sellf left behind by an earlier run, then fail on every actual
    // read/write inside it.
    const binDir = mkdtempSync(path.join(tmpdir(), 'sellf-fake-bin-'));
    fakeBin(binDir, 'id', 0, '1000');
    fakeBin(binDir, 'mkdir', 0); // would succeed if it were ever called

    const { stdout } = await execFileAsync('bash', [path.join(workDir, 'harness.sh')], {
      env: { PATH: `${binDir}:${process.env.PATH}` },
    });

    expect(stdout.trim()).toBe('/tmp');
  });

  it('uses the resolved RUNTIME_DIR for the progress, log, and lock file paths', () => {
    expect(SCRIPT_SOURCE).toContain('PROGRESS_FILE="${RUNTIME_DIR}/sellf-upgrade-${TOKEN}.json"');
    expect(SCRIPT_SOURCE).toContain('LOG_FILE="${RUNTIME_DIR}/sellf-upgrade-${TOKEN}.log"');
    expect(SCRIPT_SOURCE).toContain('LOCK_FILE="${RUNTIME_DIR}/sellf-upgrade-${INSTANCE_NAME}.lock"');
  });
});
