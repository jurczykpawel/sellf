/** Complete installed bootstrap against signed local HTTP assets. @see scripts/upgrade.sh */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('delegates only verified, compatible releases and retains legacy fallback and rollback', async () => {
  const { stdout } = await promisify(execFile)('python3', [
    path.resolve(__dirname, 'fixtures/upgrade-bootstrap.py'),
    path.resolve(__dirname, '../../../scripts/upgrade.sh'),
  ], { timeout: 90000 });
  expect(stdout).toContain('PASS 7 full updater cases');
}, 95000);
