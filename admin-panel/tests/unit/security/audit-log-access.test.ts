import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ============================================================================
 * SECURITY TEST: Audit Log Access Control
 * ============================================================================
 *
 * Tests the REAL migration SQL to verify RLS policies on the audit_log table.
 *
 * VULNERABILITY: Unrestricted Audit Log INSERT (V-CRITICAL-09)
 * LOCATION: supabase/migrations/20250101000000_core_schema.sql
 *
 * ATTACK FLOW (before fix):
 * 1. Any authenticated or anonymous user could INSERT into audit_log directly
 * 2. Attacker forges audit entries to cover tracks or frame others
 * 3. Compliance audit becomes unreliable (cannot trust audit trail)
 *
 * FIX (V19): Added TO service_role to restrict direct INSERTs
 *
 * Created during security audit iteration 8 (2026-01-08)
 * Rewritten to test real migration SQL (2026-02-26)
 * ============================================================================
 */

const migrationPath = join(__dirname, '../../../../supabase/migrations/20250101000000_core_schema.sql');
const migrationSQL = readFileSync(migrationPath, 'utf-8');

describe('Audit Log Access Control', () => {
  describe('Table Definition', () => {
    it('audit_log table has RLS enabled', () => {
      expect(migrationSQL).toMatch(/ALTER\s+TABLE\s+audit_log\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/);
    });

    it('operation column has CHECK constraint for INSERT, UPDATE, DELETE', () => {
      expect(migrationSQL).toMatch(
        /operation\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*operation\s+IN\s*\(\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*\)\s*\)/
      );
    });

    it('table has performed_at column with default NOW()', () => {
      expect(migrationSQL).toMatch(/performed_at\s+TIMESTAMPTZ\s+DEFAULT\s+NOW\(\)\s+NOT\s+NULL/);
    });

    it('table has user_id column referencing auth.users', () => {
      expect(migrationSQL).toMatch(/user_id\s+UUID\s+REFERENCES\s+auth\.users\(id\)/);
    });

    it('table has performed_at index for efficient queries', () => {
      expect(migrationSQL).toMatch(
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_audit_log_performed_at\s+ON\s+audit_log\s*\(\s*performed_at\s+DESC\s*\)/
      );
    });
  });

  describe('RLS Policy: INSERT restricted to service_role', () => {
    it('INSERT policy is restricted TO service_role (not anon or authenticated)', () => {
      const insertPolicyMatch = migrationSQL.match(
        /CREATE\s+POLICY\s+"Allow system to insert audit logs"\s+ON\s+audit_log[\s\S]*?;/
      );
      expect(insertPolicyMatch).not.toBeNull();
      const insertPolicy = insertPolicyMatch![0];
      expect(insertPolicy).toMatch(/TO\s+service_role/);
      expect(insertPolicy).not.toMatch(/TO\s+anon/);
      expect(insertPolicy).not.toMatch(/TO\s+authenticated/);
    });
  });

  describe('RLS Policy: SELECT requires authenticated + admin check', () => {
    it('SELECT policy requires authenticated role and checks admin_users with auth.uid()', () => {
      const selectPolicyMatch = migrationSQL.match(
        /CREATE\s+POLICY\s+"Allow admin users to read audit logs"\s+ON\s+audit_log[\s\S]*?;/
      );
      expect(selectPolicyMatch).not.toBeNull();
      const selectPolicy = selectPolicyMatch![0];
      expect(selectPolicy).toMatch(/TO\s+authenticated/);
      expect(selectPolicy).toContain('admin_users');
      expect(selectPolicy).toMatch(/auth\.uid\(\)/);
    });
  });

  describe('Audit log immutability: no UPDATE or DELETE policies', () => {
    it('no UPDATE policy exists on audit_log', () => {
      // Search for any policy on audit_log with FOR UPDATE
      const updatePolicyRegex = /CREATE\s+POLICY\s+[^;]*ON\s+audit_log\s+FOR\s+UPDATE/i;
      expect(migrationSQL).not.toMatch(updatePolicyRegex);
    });

    it('no DELETE policy for regular users on audit_log', () => {
      // Verify no DELETE policy with TO authenticated or TO anon on audit_log
      const deletePolicyRegex = /CREATE\s+POLICY\s+[^;]*ON\s+audit_log\s+FOR\s+DELETE\s+TO\s+(authenticated|anon)/i;
      expect(migrationSQL).not.toMatch(deletePolicyRegex);
    });
  });

  describe('log_audit_entry() function properties', () => {
    it('function uses SECURITY DEFINER to bypass RLS', () => {
      // Extract the log_audit_entry function definition
      const fnMatch = migrationSQL.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+log_audit_entry\([\s\S]*?\$\$\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/
      );
      expect(fnMatch).not.toBeNull();
    });

    it('function sets secure search_path', () => {
      const fnBlockMatch = migrationSQL.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+log_audit_entry\([\s\S]*?SET\s+search_path\s*=\s*''/
      );
      expect(fnBlockMatch).not.toBeNull();
    });

    it('function is granted to service_role and authenticated', () => {
      expect(migrationSQL).toMatch(
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+log_audit_entry\s+TO\s+service_role\s*,\s*authenticated/
      );
    });

    it('function validates table_name length (1-100 chars)', () => {
      const fnMatch = migrationSQL.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+log_audit_entry\([\s\S]*?END;\s*\$\$/
      );
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch![0];
      expect(fnBody).toContain('length(table_name_param) > 100');
    });

    it('function validates operation is INSERT, UPDATE, or DELETE', () => {
      const fnMatch = migrationSQL.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+log_audit_entry\([\s\S]*?END;\s*\$\$/
      );
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch![0];
      expect(fnBody).toMatch(/operation_param\s+NOT\s+IN\s*\(\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*\)/);
    });

    it('function limits JSONB size to 64KB for DoS prevention', () => {
      const fnMatch = migrationSQL.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+log_audit_entry\([\s\S]*?END;\s*\$\$/
      );
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch![0];
      expect(fnBody).toContain('pg_column_size(old_values_param) > 65536');
      expect(fnBody).toContain('pg_column_size(new_values_param) > 65536');
    });
  });
});
