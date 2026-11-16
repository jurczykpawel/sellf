/**
 * DB TEST: the schema snapshot behind `schema:check` catches
 * changes in the state of objects outside `public`, bytes of function bodies) and does not raise a false alarm
 * for the order equivalent grants were made in.
 *
 * Each probe changes the local test database, captures the snapshot before and after with the
 * script's own capture code, and reverts the change. Row counts are cut off: rows on a live stack
 * change (pg_cron), the probes are about schema state.
 *
 * REQUIRES: the local Supabase stack (SUPABASE_URL / SUPABASE_DB_CONTAINER); platform tables are
 * changed as supabase_admin (local default password).
 *
 * @see admin-panel/scripts/schema-snapshot.ts
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { ROW_COUNTS_HEADING, buildSnapshot, captureSchema, snapshotDiff } from '@/../scripts/schema-snapshot';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const container = getTestDatabaseContainer();

function superuser(sql: string): string {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8',
  }).trim();
}

function snapshot(): string {
  const full = buildSnapshot({ cliVersion: 'probe', ...captureSchema(container) });
  const cut = full.indexOf(ROW_COUNTS_HEADING);
  expect(cut).toBeGreaterThan(0);
  return full.slice(0, cut);
}

interface Probe {
  name: string;
  apply: string;
  revert: string;
  /** Catalog value proving the change really happened (not a silently failed statement). */
  proof: string;
  proofAfter: string;
  /** A line of the unified diff the gate prints. */
  diffLine: RegExp;
}

const PROBES: Probe[] = [
  {
    name: 'a disabled trigger on auth.users (signup no longer creates the profile)',
    apply: 'ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;',
    revert: 'ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;',
    proof: "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created';",
    proofAfter: 'D',
    diffLine: /^\+auth\.users \| on_auth_user_created \| D \| CREATE TRIGGER/m,
  },
  {
    name: 'a grant on auth.users to anon',
    apply: 'GRANT SELECT ON auth.users TO anon;',
    revert: 'REVOKE SELECT ON auth.users FROM anon;',
    proof: "SELECT has_table_privilege('anon', 'auth.users', 'SELECT');",
    proofAfter: 't',
    diffLine: /^\+table \| auth\.users \| anon \| SELECT \|/m,
  },
  {
    name: 'a column grant on auth.users to anon',
    apply: 'GRANT SELECT (email) ON auth.users TO anon;',
    revert: 'REVOKE SELECT (email) ON auth.users FROM anon;',
    proof: "SELECT has_column_privilege('anon', 'auth.users', 'email', 'SELECT');",
    proofAfter: 't',
    diffLine: /^\+column \| auth\.users\.email \| anon \| SELECT \|/m,
  },
  {
    name: 'RLS switched off on auth.users',
    apply: 'ALTER TABLE auth.users DISABLE ROW LEVEL SECURITY;',
    revert: 'ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;',
    proof: "SELECT relrowsecurity FROM pg_class WHERE oid = 'auth.users'::regclass;",
    proofAfter: 'f',
    diffLine: /^\+auth\.users \| f \| f$/m,
  },
  {
    name: 'a deactivated cron job',
    apply: "UPDATE cron.job SET active = false WHERE jobname = 'cleanup-rate-limits';",
    revert: "UPDATE cron.job SET active = true WHERE jobname = 'cleanup-rate-limits';",
    proof: "SELECT active FROM cron.job WHERE jobname = 'cleanup-rate-limits';",
    proofAfter: 'f',
    diffLine: /^\+cleanup-rate-limits \| 0 \* \* \* \* \| f \| postgres \| postgres \|/m,
  },
  {
    name: 'a cron job running as another user',
    apply: "UPDATE cron.job SET username = 'authenticated' WHERE jobname = 'cleanup-rate-limits';",
    revert: "UPDATE cron.job SET username = 'postgres' WHERE jobname = 'cleanup-rate-limits';",
    proof: "SELECT username FROM cron.job WHERE jobname = 'cleanup-rate-limits';",
    proofAfter: 'authenticated',
    diffLine: /^\+cleanup-rate-limits \| 0 \* \* \* \* \| t \| postgres \| authenticated \|/m,
  },
];

describe('schema snapshot probes', () => {
  it.each(PROBES)('FAILs on $name', ({ apply, revert, proof, proofAfter, diffLine }) => {
    const before = snapshot();
    try {
      superuser(apply);
      expect(superuser(proof)).toBe(proofAfter);
      const diff = snapshotDiff(before, snapshot());
      expect(diff).not.toBeNull();
      expect(diff).toMatch(diffLine);
    } finally {
      superuser(revert);
    }
    expect(snapshot()).toBe(before);
  });

  // A standalone `CREATE TYPE ... AS (...)` has a pg_class row of relkind 'c', so `typrelid` is set;
  // With GRANT lines dumped away (--no-privileges) its USAGE must still reach the snapshot.
  describe('privileges of a standalone composite type', () => {
    const type = 'public.w256c_probe_composite';
    const role = 'w256c_probe_custom';
    const typeAcl = () => superuser(`SELECT coalesce(typacl::text, '-') FROM pg_type WHERE oid = '${type}'::regtype;`);
    const withType = (probe: (before: string) => void) => {
      try {
        superuser(`SET client_min_messages = warning; DROP TYPE IF EXISTS ${type}; DROP ROLE IF EXISTS ${role}; CREATE ROLE ${role} NOLOGIN; CREATE TYPE ${type} AS (x int);`);
        probe(snapshot());
      } finally {
        superuser(`DROP TYPE IF EXISTS ${type}; DROP ROLE IF EXISTS ${role};`);
      }
    };

    it('FAILs when USAGE is revoked from PUBLIC', () => withType((before) => {
      superuser(`REVOKE USAGE ON TYPE ${type} FROM PUBLIC;`);
      expect(superuser(`SELECT has_type_privilege('${role}', '${type}', 'USAGE');`)).toBe('f');
      const diff = snapshotDiff(before, snapshot());
      expect(diff).not.toBeNull();
      expect(diff).toMatch(/^-type \| public\.w256c_probe_composite \| PUBLIC \| USAGE \|/m);
    }));

    it('FAILs when a custom role gets USAGE WITH GRANT OPTION', () => withType((before) => {
      superuser(`GRANT USAGE ON TYPE ${type} TO ${role} WITH GRANT OPTION;`);
      expect(typeAcl()).toContain(`${role}=U*/`);
      const diff = snapshotDiff(before, snapshot());
      expect(diff).not.toBeNull();
      expect(diff).toMatch(/^\+type \| public\.w256c_probe_composite \| w256c_probe_custom \| USAGE \| .* \| WITH GRANT OPTION$/m);
    }));
  });

  it('FAILs when a function literal loses two trailing spaces (function bodies compared byte for byte)', () => {
    const fn = 'public.w256b_probe_literal';
    const create = (literal: string) => `CREATE OR REPLACE FUNCTION ${fn}() RETURNS text LANGUAGE sql AS $body$ SELECT '${literal}' $body$;`;
    try {
      superuser(create('a  \nb'));
      expect(superuser(`SELECT encode(convert_to(${fn}(), 'UTF8'), 'hex');`)).toBe('6120200a62');
      const withSpaces = snapshot();
      superuser(create('a\nb'));
      expect(superuser(`SELECT encode(convert_to(${fn}(), 'UTF8'), 'hex');`)).toBe('610a62');
      expect(snapshotDiff(withSpaces, snapshot())).not.toBeNull();
    } finally {
      superuser(`DROP FUNCTION IF EXISTS ${fn}();`);
    }
  });

  it('PASSes when the same grants were made in the opposite order (ACL records are canonical)', () => {
    const table = 'public.w256b_probe_acl';
    const acl = () => superuser(`SELECT relacl::text FROM pg_class WHERE oid = '${table}'::regclass;`);
    try {
      // REVOKE first: default privileges already grant the new table to anon/authenticated.
      superuser(`CREATE TABLE ${table} (id int); REVOKE ALL ON ${table} FROM anon, authenticated;
        GRANT SELECT ON ${table} TO anon; GRANT SELECT ON ${table} TO authenticated;`);
      const firstAcl = acl();
      const first = snapshot();
      superuser(`REVOKE SELECT ON ${table} FROM anon, authenticated; GRANT SELECT ON ${table} TO authenticated; GRANT SELECT ON ${table} TO anon;`);
      // The catalog array really is in another order; only the snapshot must not care.
      expect(acl()).not.toBe(firstAcl);
      expect(snapshotDiff(first, snapshot())).toBeNull();
    } finally {
      superuser(`DROP TABLE IF EXISTS ${table};`);
    }
  });
});
