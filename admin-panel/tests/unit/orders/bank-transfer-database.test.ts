/** Transactional transfer acceptance using the assigned local database. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
describe('transfer SQL acceptance', () => {
  it('places, confirms, cancels and limits offline orders atomically', () => {
    const output = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: readFileSync('../supabase/tests/bank-transfer.sql'), encoding: 'utf8',
    });
    expect(output).toContain('ROLLBACK');
  });
  it('times, extends, holds on invoice, releases and reopens unpaid transfer orders', () => {
    const output = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: readFileSync('../supabase/tests/unpaid-orders.sql'), encoding: 'utf8',
    });
    expect(output).toContain('ROLLBACK');
  });
});
