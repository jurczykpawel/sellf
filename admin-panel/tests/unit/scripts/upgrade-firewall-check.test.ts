import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/upgrade.sh');
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

/**
 * The firewall check runs after "Upgrade complete!" and before the temp-dir
 * cleanup and the MIGRATION_ERRORS exit. It only warns, so it must never end
 * the script: under `set -euo pipefail` a `grep` that finds no `-P INPUT`
 * line (no permission, nftables-only host, container) used to kill `main`
 * with exit 1 after a successful upgrade (seen on the Linux release gate,
 * GHA run 45620689635). Extract the block verbatim and run it for real
 * against fake iptables/ip6tables binaries.
 *
 * @see scripts/upgrade.sh (firewall-check block)
 */
function extractBlock(startMarker: string, endMarker: string): string {
  const start = SCRIPT_SOURCE.indexOf(startMarker);
  const end = SCRIPT_SOURCE.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find block between "${startMarker}" and "${endMarker}" in upgrade.sh`);
  }
  return SCRIPT_SOURCE.slice(start + startMarker.length, end);
}

const FIREWALL_BLOCK = extractBlock(
  '# firewall-check:start — extracted verbatim by tests/unit/scripts/upgrade-firewall-check.test.ts',
  '# firewall-check:end',
);

let harnessPath: string;

beforeAll(() => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'sellf-firewall-harness-'));
  const harness = `#!/usr/bin/env bash
set -euo pipefail
TMP_DIR="$1"
MIGRATION_ERRORS="$2"
PORT=3333
BACKUP_DIR=/backup
log() { echo "LOG: $*"; }
${FIREWALL_BLOCK}
echo "REACHED_END"
`;
  harnessPath = path.join(workDir, 'harness.sh');
  writeFileSync(harnessPath, harness);
  chmodSync(harnessPath, 0o755);
});

interface FakeFirewall {
  stdout: string;
  exitCode: number;
}

/** Fake iptables + ip6tables on PATH so the result never depends on the runner's real firewall. */
function fakeFirewallBin(fw: FakeFirewall): string {
  const binDir = mkdtempSync(path.join(tmpdir(), 'sellf-fake-fw-'));
  const script = `#!/usr/bin/env bash\nprintf '%b' '${fw.stdout}'\nexit ${fw.exitCode}\n`;
  for (const name of ['iptables', 'ip6tables']) {
    writeFileSync(path.join(binDir, name), script);
    chmodSync(path.join(binDir, name), 0o755);
  }
  return binDir;
}

async function runFirewallCheck(fw: FakeFirewall, migrationErrors = 0) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'sellf-upgrade-tmp-'));
  const binDir = fakeFirewallBin(fw);
  try {
    const { stdout } = await execFileAsync('bash', [harnessPath, tmpDir, String(migrationErrors)], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
    return { code: 0, stdout, tmpDirExists: existsSync(tmpDir) };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '', tmpDirExists: existsSync(tmpDir) };
  }
}

describe('upgrade.sh firewall check (extracted verbatim from scripts/upgrade.sh)', () => {
  it('warns but exits 0 and cleans TMP_DIR when iptables prints no INPUT policy line', async () => {
    const result = await runFirewallCheck({ stdout: '-A INPUT -i lo -j ACCEPT\\n', exitCode: 0 });
    expect(result.stdout).toContain('WARN: ip6tables INPUT policy = UNKNOWN');
    expect(result.stdout).toContain('WARN: iptables INPUT policy = UNKNOWN');
    expect(result.stdout).toContain('Temp files cleaned up');
    expect(result.stdout).toContain('REACHED_END');
    expect(result.code).toBe(0);
    expect(result.tmpDirExists).toBe(false);
  });

  it('warns but exits 0 and cleans TMP_DIR when iptables itself fails (no permission)', async () => {
    const result = await runFirewallCheck({ stdout: '', exitCode: 4 });
    expect(result.stdout).toContain('WARN: ip6tables INPUT policy = UNKNOWN');
    expect(result.stdout).toContain('WARN: iptables INPUT policy = UNKNOWN');
    expect(result.stdout).toContain('REACHED_END');
    expect(result.code).toBe(0);
    expect(result.tmpDirExists).toBe(false);
  });

  it('warns with the reported policy when INPUT is not DROP', async () => {
    const result = await runFirewallCheck({ stdout: '-P INPUT ACCEPT\\n', exitCode: 0 });
    expect(result.stdout).toContain('WARN: iptables INPUT policy = ACCEPT');
    expect(result.stdout).toContain('WARN: ip6tables INPUT policy = ACCEPT');
    expect(result.code).toBe(0);
  });

  it('stays silent when INPUT policy is DROP on both stacks', async () => {
    const result = await runFirewallCheck({ stdout: '-P INPUT DROP\\n-A INPUT -i lo -j ACCEPT\\n', exitCode: 0 });
    expect(result.stdout).not.toContain('WARN');
    expect(result.stdout).toContain('REACHED_END');
    expect(result.code).toBe(0);
    expect(result.tmpDirExists).toBe(false);
  });

  it('still exits 1 after cleanup when migrations failed', async () => {
    const result = await runFirewallCheck({ stdout: '-P INPUT DROP\\n', exitCode: 0 }, 1);
    expect(result.stdout).toContain('Temp files cleaned up');
    expect(result.stdout).not.toContain('REACHED_END');
    expect(result.code).toBe(1);
    expect(result.tmpDirExists).toBe(false);
  });
});
