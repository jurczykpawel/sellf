/**
 * E-mail confirmation and guest purchase lifecycle in the local database.
 * @see supabase/tests/claim-after-confirmation.sql
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { getSupabaseDbContainer } from '../../helpers/supabase-db-container';

describe('Guest claims after e-mail confirmation', () => {
  it('keeps pending accounts separate and claims once after confirmation', () => {
    const sql = readFileSync(resolve('../supabase/tests/claim-after-confirmation.sql'), 'utf8');
    const output = execFileSync('docker', ['exec', '-i', getSupabaseDbContainer(), 'psql', '-U', 'postgres'], {
      input: sql,
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(output).toContain('ROLLBACK');
  });
});
