/**
 * DB TEST: maintenance mode, the database source. set_maintenance_mode switches it and writes the
 * audit entry in ONE transaction (a refused entry changes nothing); get_maintenance_mode is the only
 * thing anon can read, and it shows the message only while the mode is on.
 * Every case runs in a rolled-back transaction, so the shop is never put into maintenance for other tests.
 *
 * REQUIRES: the local Supabase stack.
 * @see supabase/migrations/20261117130000_maintenance_mode.sql
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

function sql(body: string, role = 'service_role'): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; SET LOCAL request.jwt.claims='{"role":"${role}"}'; ${body} ROLLBACK;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
function sqlError(body: string, role = 'service_role'): string {
  try {
    sql(body, role);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error('Expected the SQL to fail');
}
const actor = `(SELECT id FROM auth.users ORDER BY created_at LIMIT 1)`;
const lastAudit = `(SELECT count(*) FROM public.audit_log WHERE table_name = 'maintenance_mode')`;

describe('maintenance mode in the database', () => {
  it('a valid change switches the mode and writes one audit entry with the previous and new state', () => {
    const out = sql(`
      CREATE TEMP TABLE before_count AS SELECT ${lastAudit} AS n;
      SELECT public.set_maintenance_mode(true, '  Moving servers  ', '2030-01-01T10:00:00Z', ${actor}, '{"auth":"session"}')->>'enabled';
      SELECT enabled, message, expected_end_at = '2030-01-01T10:00:00Z' FROM public.get_maintenance_mode();
      SELECT ${lastAudit} - (SELECT n FROM before_count);
      SELECT old_values->>'enabled', new_values->>'enabled', new_values->>'message', new_values->>'auth', performed_by = ${actor}
        FROM public.audit_log WHERE table_name = 'maintenance_mode' ORDER BY performed_at DESC LIMIT 1;
    `);
    expect(out.split('\n')).toEqual(['BEGIN', 'SET', 'SELECT 1', 'false', 't|Moving servers|t', '1', 'false|true|Moving servers|session|t', 'ROLLBACK']);
  });

  it('a refused audit entry (actor is not an auth user) leaves the mode and the log unchanged', () => {
    const error = sqlError(`SELECT public.set_maintenance_mode(true, NULL, NULL, gen_random_uuid());`);
    expect(error).toMatch(/foreign key/);
    expect(sql(`SELECT enabled FROM public.maintenance_mode;`).split('\n')).toContain('f');
  });

  it('the message and expected end stay hidden from anon while the mode is off', () => {
    const out = sql(`
      SELECT public.set_maintenance_mode(false, 'internal note', '2030-01-01T10:00:00Z', ${actor});
      SET LOCAL ROLE anon; SET LOCAL request.jwt.claims='{"role":"anon"}';
      SELECT enabled::text || '|' || coalesce(message, '-') || '|' || coalesce(expected_end_at::text, '-') FROM public.get_maintenance_mode();
    `);
    expect(out).toContain('false|-|-');
  });

  it('anon and authenticated cannot switch the mode or read the table', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(sqlError(`SET LOCAL ROLE ${role}; SELECT public.set_maintenance_mode(true, NULL, NULL, ${actor});`, role)).toMatch(/permission denied/);
    }
    expect(sqlError(`SET LOCAL ROLE anon; SELECT * FROM public.maintenance_mode;`, 'anon')).toMatch(/permission denied/);
  });

  it('rejects a message longer than 500 characters', () => {
    expect(sqlError(`SELECT public.set_maintenance_mode(true, repeat('x', 501), NULL, ${actor});`)).toMatch(/Invalid maintenance mode change/);
  });
});
