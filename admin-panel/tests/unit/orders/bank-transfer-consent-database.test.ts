/** Actual placement must accept an exempt buyer without recording a new agreement. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
it('preserves buyer consent through the service-only placement contract', () => {
  const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync('../supabase/tests/bank-transfer-consent.sql'), encoding: 'utf8',
  });
  expect(result).toContain('ROLLBACK');
});
