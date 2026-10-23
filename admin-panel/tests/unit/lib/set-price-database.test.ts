/** Coupon database acceptance. @see supabase/tests/set-price.sql */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
it('validates set price type, currency and zero-decimal amounts in SQL', () => {
  const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync('../supabase/tests/set-price.sql'), encoding: 'utf8',
  });
  expect(result).toContain('ROLLBACK');
});
