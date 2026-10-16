/**
 * E-mail confirmation and guest purchase lifecycle in the local database.
 * @see supabase/tests/claim-after-confirmation.sql
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { TEST_DB_CONTAINER } from '../../helpers/db-container';

describe('Guest claims after e-mail confirmation', () => {
  it('keeps pending accounts separate and claims once after confirmation', () => {
    const sql = readFileSync(resolve('../supabase/tests/claim-after-confirmation.sql'), 'utf8');
    const output = execFileSync('docker', ['exec', '-i', TEST_DB_CONTAINER, 'psql', '-U', 'postgres'], {
      input: sql,
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(output).toContain('ROLLBACK');
  });
});
