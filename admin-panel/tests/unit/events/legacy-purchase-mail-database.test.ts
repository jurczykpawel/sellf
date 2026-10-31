/** Historical paid guest purchases must remain eligible for their first access email. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
it('resolves the entitlement belonging to the paid order', () => {
  const output = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync('../supabase/tests/legacy-purchase-mail.sql'), encoding: 'utf8',
  });
  expect(output).toContain('ROLLBACK');
});
