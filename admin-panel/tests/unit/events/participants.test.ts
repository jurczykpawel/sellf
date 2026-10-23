/** Participant recording access through real completion and registration. @see supabase/tests/event-participants.sql */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

it('grants three participant recording bundles without assigning the buyer transaction', () => {
  const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync(resolve(__dirname, '../../../../supabase/tests/event-participants.sql')), encoding: 'utf8',
  });
  expect(result).toContain('ROLLBACK');
});
