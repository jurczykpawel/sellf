/**
 * SECURITY TEST: grants that have no matching RLS policy for that role.
 *
 * A GRANT without a matching CREATE POLICY for the same role/command grants
 * nothing in practice — PostgREST/Supabase clients using that role can never
 * actually perform the operation — so it should not exist. This locks in
 * that these two grants stay revoked:
 *
 *   - api_key_audit_log: authenticated only has a SELECT policy, so the
 *     INSERT grant can never succeed — every write goes through the
 *     service-role client instead.
 *   - guest_purchases: authenticated has no DELETE policy at all, so the
 *     DELETE grant can never succeed — access revocation always runs
 *     through an admin/service-role client.
 *
 * REQUIRES: `npx supabase start` + `npx supabase db reset`.
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';

const CONTAINER = 'supabase_db_sellf';

function queryRows(sql: string): string[] {
  const out = execSync(`docker exec -i ${CONTAINER} psql -U postgres -t -A`, {
    input: sql,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('grants without a matching RLS policy are revoked', () => {
  it('authenticated has no INSERT grant on api_key_audit_log', () => {
    const rows = queryRows(`
      SELECT grantee || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'api_key_audit_log'
        AND grantee = 'authenticated'
        AND privilege_type = 'INSERT';
    `);
    expect(rows).toEqual([]);
  });

  it('authenticated still has SELECT on api_key_audit_log (admins read their own logs)', () => {
    const rows = queryRows(`
      SELECT grantee || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'api_key_audit_log'
        AND grantee = 'authenticated'
        AND privilege_type = 'SELECT';
    `);
    expect(rows).toEqual(['authenticated:SELECT']);
  });

  it('authenticated has no DELETE grant on guest_purchases', () => {
    const rows = queryRows(`
      SELECT grantee || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'guest_purchases'
        AND grantee = 'authenticated'
        AND privilege_type = 'DELETE';
    `);
    expect(rows).toEqual([]);
  });

  it('service_role keeps full access to both tables', () => {
    const rows = queryRows(`
      SELECT table_name || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('api_key_audit_log', 'guest_purchases')
        AND grantee = 'service_role'
        AND privilege_type IN ('INSERT', 'DELETE')
      ORDER BY 1;
    `);
    expect(rows).toEqual([
      'api_key_audit_log:DELETE',
      'api_key_audit_log:INSERT',
      'guest_purchases:DELETE',
      'guest_purchases:INSERT',
    ]);
  });
});
