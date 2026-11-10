import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
it('records manual corrections and keeps corrected orders closed', () => {
 const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync('../supabase/tests/manual-invoice-correction.sql'), encoding:'utf8' });
 expect(result).toContain('ROLLBACK');
});
