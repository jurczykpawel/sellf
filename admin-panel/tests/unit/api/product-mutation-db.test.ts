/** @see supabase/migrations/20261015120000_product_mutation_audit.sql */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('commits product snapshots together and rolls back each mutation on audit failure', () => {
  const migration = readFileSync(resolve('../supabase/migrations/20261015120000_product_mutation_audit.sql'), 'utf8');
  const assertions = readFileSync(resolve('tests/unit/api/product-mutation.sql'), 'utf8');
  const result = execFileSync('docker', [
    'exec', '-i', 'supabase_db_sellf', 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
  ], { input: `BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '15s';\n${migration}\n${assertions}\nROLLBACK;`, encoding: 'utf8' });
  expect(result).toContain('ROLLBACK');
}, 30000);
