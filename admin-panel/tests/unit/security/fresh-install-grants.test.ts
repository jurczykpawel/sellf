/**
 * SECURITY TEST: grants on a database built purely from migrations.
 *
 * A fresh install (local CLI, self-hosters) inherits Supabase's default
 * privileges, which on some platforms hand anon/authenticated TRUNCATE,
 * TRIGGER and REFERENCES on every new table. TRUNCATE bypasses RLS. Production
 * never had these, so migrations must make fresh installs match it.
 *
 * REQUIRES: `npx supabase start` + `npx supabase db reset`.
 *
 * @see supabase/migrations/20260910000000_auth_hardening.sql
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

describe('fresh-install grants match production least privilege', () => {
  it('anon and authenticated hold no TRUNCATE/TRIGGER/REFERENCES on any public table', () => {
    const rows = queryRows(`
      SELECT table_name || ':' || grantee || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
      ORDER BY 1;
    `);
    expect(rows).toEqual([]);
  });

  it('default privileges for new public tables do not grant TRUNCATE/TRIGGER/REFERENCES to anon or authenticated', () => {
    const rows = queryRows(`
      SELECT a::text
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL unnest(d.defaclacl) AS a
      WHERE n.nspname = 'public'
        AND pg_get_userbyid(d.defaclrole) = 'postgres'
        AND d.defaclobjtype = 'r'
        AND (a::text LIKE 'anon=%' OR a::text LIKE 'authenticated=%')
        AND split_part(split_part(a::text, '=', 2), '/', 1) ~ '[Dxt]';
    `);
    expect(rows).toEqual([]);
  });

  it('authenticated can execute grant_free_product_access (free product claim)', () => {
    const rows = queryRows(`
      SELECT has_function_privilege(
        'authenticated',
        'public.grant_free_product_access(text, integer, text)',
        'EXECUTE'
      )::text;
    `);
    expect(rows).toEqual(['true']);
  });

  it('anon still cannot execute grant_free_product_access', () => {
    const rows = queryRows(`
      SELECT has_function_privilege(
        'anon',
        'public.grant_free_product_access(text, integer, text)',
        'EXECUTE'
      )::text;
    `);
    expect(rows).toEqual(['false']);
  });
});
