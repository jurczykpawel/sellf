/** Saved participant list must clear the seller's missing-data indicator. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
it('reconciles missing checkout data after participants are submitted', () => {
  const output = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync('../supabase/tests/participants-later.sql'), encoding: 'utf8' });
  expect(output).toContain('ROLLBACK');
});
