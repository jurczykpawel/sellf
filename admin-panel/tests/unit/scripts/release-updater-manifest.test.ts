/** CI must preserve the 10.6 bridge without publishing a minimum bypass. */
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { expect, it } from 'vitest';
it('emits the signed-v2 input and emits legacy only for minimum 1', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-manifest-'));
  try {
    const archive = path.join(dir, 'build.tar.gz'); const updater = path.join(dir, 'upgrade.sh');
    writeFileSync(archive, 'fixture');
    const write = (minimum: number) => {
      writeFileSync(updater, `MIN_UPDATER_VERSION=${minimum}\n`);
      execFileSync('bash', [path.resolve(__dirname, '../../../scripts/ci/write-release-manifests.sh'), '2026.11.0', archive, dir, updater]);
    };
    write(1);
    expect(readFileSync(path.join(dir, 'sellf-build.manifest'), 'utf8').split('\n')).toHaveLength(3);
    expect(readFileSync(path.join(dir, 'sellf-build.v2.manifest'), 'utf8')).toContain('min_updater_version=1\n');
    write(2);
    expect(existsSync(path.join(dir, 'sellf-build.manifest'))).toBe(false);
    expect(readFileSync(path.join(dir, 'sellf-build.v2.manifest'), 'utf8')).toContain('min_updater_version=2\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
