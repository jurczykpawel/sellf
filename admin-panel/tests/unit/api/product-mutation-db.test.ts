/** @see supabase/migrations/20261016000000_release_2026_10_6.sql */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';

it('commits product snapshots together and rolls back each mutation on audit failure', () => {
  const assertions = readFileSync(resolve('tests/unit/api/product-mutation.sql'), 'utf8');
  const result = execFileSync('docker', [
    'exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
  ], { input: `BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '15s';\n${assertions}\nROLLBACK;`, encoding: 'utf8' });
  expect(result).toContain('ROLLBACK');
}, 30000);
