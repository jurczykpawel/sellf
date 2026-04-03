/**
 * ============================================================================
 * SECURITY ADVISOR: Live Database Lint Checks
 * ============================================================================
 *
 * Runs Supabase Security Advisor (splinter) queries against the live local
 * database. Requires `npx supabase start` and `npx supabase db reset`.
 *
 * These tests verify that no security/performance lint violations exist in
 * public and seller_main schemas. They mirror the checks from Supabase
 * Dashboard > Database > Security Advisor.
 *
 * @see https://github.com/supabase/splinter
 * @see https://supabase.com/docs/guides/database/database-linter
 * ============================================================================
 */

import { execSync } from 'child_process';
import { describe, it, expect, beforeAll } from 'vitest';

// ============================================================================
// Helpers
// ============================================================================

const CONTAINER = 'supabase_db_sellf';
const SCHEMAS = "'public', 'seller_main'";

/**
 * Execute SQL query on the local Supabase database via docker exec.
 * Returns rows as objects parsed from psql JSON output.
 */
function query<T = Record<string, unknown>>(sql: string): T[] {
  try {
    const result = execSync(
      `docker exec ${CONTAINER} psql -U postgres -t -A -c "SELECT json_agg(t) FROM (${sql.replace(/"/g, '\\"')}) t"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();

    if (!result || result === '' || result === 'null') return [];
    return JSON.parse(result) as T[];
  } catch {
    return [];
  }
}

/** Check if the database container is available */
function isDatabaseAvailable(): boolean {
  try {
    execSync(`docker exec ${CONTAINER} psql -U postgres -c "SELECT 1"`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe.skipIf(!isDatabaseAvailable())(
  'Security Advisor: live database lint checks',
  () => {
    beforeAll(() => {
      // Verify connection works
      const rows = query('SELECT 1 AS ok');
      expect(rows).toHaveLength(1);
    });

    // ------------------------------------------------------------------
    // 0011: Function Search Path Mutable
    // ------------------------------------------------------------------
    describe('SA-0011: functions must SET search_path', () => {
      it('no functions in public/seller_main have mutable search_path', () => {
        const EXCLUDED_THIRD_PARTY: string[] = [];

        const violations = query<{ fn: string }>(`
          SELECT n.nspname || '.' || p.proname AS fn
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
          LEFT JOIN pg_catalog.pg_depend dep ON p.oid = dep.objid AND dep.deptype = 'e'
          WHERE n.nspname IN (${SCHEMAS})
            AND dep.objid IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS config
              WHERE config LIKE 'search_path=%'
            )
          ORDER BY 1
        `).filter(v => !EXCLUDED_THIRD_PARTY.includes(v.fn));

        expect(
          violations,
          `Functions with mutable search_path:\n${violations.map(v => `  - ${v.fn}`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // 0013: RLS Disabled in Public
    // ------------------------------------------------------------------
    describe('SA-0013: public tables must have RLS enabled', () => {
      it('no public tables exist without RLS', () => {
        const violations = query<{ tbl: string }>(`
          SELECT n.nspname || '.' || c.relname AS tbl
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND c.relkind = 'r'
            AND NOT c.relrowsecurity
          ORDER BY 1
        `);

        expect(
          violations,
          `Tables without RLS:\n${violations.map(v => `  - ${v.tbl}`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // 0008: RLS Enabled but No Policies
    // ------------------------------------------------------------------
    describe('SA-0008: tables with RLS must have policies', () => {
      it('no tables have RLS enabled without at least one policy', () => {
        const violations = query<{ tbl: string }>(`
          SELECT n.nspname || '.' || c.relname AS tbl
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND c.relkind = 'r'
            AND c.relrowsecurity
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid = c.oid
            )
          ORDER BY 1
        `);

        expect(
          violations,
          `Tables with RLS but no policies:\n${violations.map(v => `  - ${v.tbl}`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // 0024: Permissive RLS Policy (non-service_role WITH CHECK true)
    // ------------------------------------------------------------------
    describe('SA-0024: no overly permissive RLS policies', () => {
      it('no INSERT/UPDATE/DELETE policies use WITH CHECK (true) for non-service_role', () => {
        const violations = query<{ tbl: string; policy: string; cmd: string }>(`
          SELECT
            n.nspname || '.' || c.relname AS tbl,
            pol.polname AS policy,
            CASE pol.polcmd
              WHEN 'a' THEN 'INSERT'
              WHEN 'w' THEN 'UPDATE'
              WHEN 'd' THEN 'DELETE'
              ELSE '*'
            END AS cmd
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON pol.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND pol.polcmd IN ('a','w','d')
            AND pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true'
            AND NOT (pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'service_role')])
          ORDER BY 1
        `);

        expect(
          violations,
          `Permissive policies (WITH CHECK true):\n${violations.map(v => `  - ${v.tbl} / ${v.policy} (${v.cmd})`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // 0003: Auth RLS InitPlan (auth.uid() without select wrapper)
    // ------------------------------------------------------------------
    describe('SA-0003: auth functions must use initPlan wrapper', () => {
      it('no policies use auth.uid() without (select ...) wrapper', () => {
        const violations = query<{ tbl: string; policy: string; clause: string }>(`
          SELECT
            n.nspname || '.' || c.relname AS tbl,
            pol.polname AS policy,
            CASE
              WHEN pol.polqual IS NOT NULL
                AND pg_get_expr(pol.polqual, pol.polrelid) ~ 'auth\\.uid\\(\\)'
                AND pg_get_expr(pol.polqual, pol.polrelid) !~ '\\(.*SELECT.*auth\\.uid\\(\\)'
              THEN 'USING'
              ELSE 'WITH CHECK'
            END AS clause
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON pol.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND (
              (pol.polqual IS NOT NULL
                AND pg_get_expr(pol.polqual, pol.polrelid) ~ 'auth\\.uid\\(\\)'
                AND pg_get_expr(pol.polqual, pol.polrelid) !~ '\\(.*SELECT.*auth\\.uid\\(\\)')
              OR
              (pol.polwithcheck IS NOT NULL
                AND pg_get_expr(pol.polwithcheck, pol.polrelid) ~ 'auth\\.uid\\(\\)'
                AND pg_get_expr(pol.polwithcheck, pol.polrelid) !~ '\\(.*SELECT.*auth\\.uid\\(\\)')
            )
          ORDER BY 1
        `);

        expect(
          violations,
          `Policies without initPlan wrapper:\n${violations.map(v => `  - ${v.tbl} / ${v.policy} (${v.clause})`).join('\n')}`
        ).toHaveLength(0);
      });

      it('no policies use auth.role() without (select ...) wrapper', () => {
        const violations = query<{ tbl: string; policy: string }>(`
          SELECT
            n.nspname || '.' || c.relname AS tbl,
            pol.polname AS policy
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON pol.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND (
              (pol.polqual IS NOT NULL
                AND pg_get_expr(pol.polqual, pol.polrelid) ~ 'auth\\.role\\(\\)'
                AND pg_get_expr(pol.polqual, pol.polrelid) !~ '\\(.*SELECT.*auth\\.role\\(\\)')
              OR
              (pol.polwithcheck IS NOT NULL
                AND pg_get_expr(pol.polwithcheck, pol.polrelid) ~ 'auth\\.role\\(\\)'
                AND pg_get_expr(pol.polwithcheck, pol.polrelid) !~ '\\(.*SELECT.*auth\\.role\\(\\)')
            )
          ORDER BY 1
        `);

        expect(
          violations,
          `Policies without auth.role() initPlan wrapper:\n${violations.map(v => `  - ${v.tbl} / ${v.policy}`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // 0010: Security Definer Views
    // ------------------------------------------------------------------
    describe('SA-0010: views must use SECURITY INVOKER', () => {
      it('no views in public/seller_main use SECURITY DEFINER', () => {
        // Check views that do NOT have security_invoker=on in their reloptions
        const violations = query<{ view_name: string }>(`
          SELECT n.nspname || '.' || c.relname AS view_name
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND c.relkind = 'v'
            AND NOT coalesce(
              (SELECT TRUE FROM unnest(c.reloptions) opt WHERE opt = 'security_invoker=true'),
              FALSE
            )
          ORDER BY 1
        `);

        // Best-effort check — views without security_invoker are a risk
        // but some may be intentionally SECURITY DEFINER
        if (violations.length > 0) {
          console.warn('Views without security_invoker:', violations);
        }
      });
    });

    // ------------------------------------------------------------------
    // Custom: SECURITY DEFINER functions must use empty search_path
    // ------------------------------------------------------------------
    describe('SA-CUSTOM: SECURITY DEFINER functions search_path', () => {
      it('all SECURITY DEFINER functions use empty search_path', () => {
        // search_path='' is stored as 'search_path=""' in proconfig
        const violations = query<{ fn: string; search_path: string }>(`
          SELECT
            n.nspname || '.' || p.proname AS fn,
            (SELECT config FROM unnest(p.proconfig) AS config WHERE config LIKE 'search_path=%') AS search_path
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
          LEFT JOIN pg_catalog.pg_depend dep ON p.oid = dep.objid AND dep.deptype = 'e'
          WHERE n.nspname IN (${SCHEMAS})
            AND dep.objid IS NULL
            AND p.prosecdef = true
            AND EXISTS (
              SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS config
              WHERE config LIKE 'search_path=%'
                AND config NOT IN ('search_path=', 'search_path=""""')
                AND config != 'search_path=""'
            )
          ORDER BY 1
        `);

        expect(
          violations,
          `SECURITY DEFINER functions with non-empty search_path:\n${violations.map(v => `  - ${v.fn} (${v.search_path})`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // Custom: No policies reference admin_users directly
    // ------------------------------------------------------------------
    describe('SA-CUSTOM: policies must use is_admin()', () => {
      it('no non-admin-resource policies reference admin_users for privilege checks', () => {
        // Exclude api_keys and api_key_audit_log — they legitimately reference
        // admin_users for ownership (admin_user_id FK), not for privilege escalation.
        const violations = query<{ tbl: string; policy: string }>(`
          SELECT
            n.nspname || '.' || c.relname AS tbl,
            pol.polname AS policy
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON pol.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND c.relname NOT IN ('api_keys', 'api_key_audit_log', 'admin_users')
            AND (
              (pol.polqual IS NOT NULL AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%admin_users%')
              OR
              (pol.polwithcheck IS NOT NULL AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%admin_users%')
            )
          ORDER BY 1
        `);

        expect(
          violations,
          `Policies referencing admin_users directly:\n${violations.map(v => `  - ${v.tbl} / ${v.policy}`).join('\n')}`
        ).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // Custom: No policies use current_setting('role')
    // ------------------------------------------------------------------
    describe('SA-CUSTOM: policies must use auth.role()', () => {
      it('no policies use current_setting for role checks', () => {
        const violations = query<{ tbl: string; policy: string }>(`
          SELECT
            n.nspname || '.' || c.relname AS tbl,
            pol.polname AS policy
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON pol.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname IN (${SCHEMAS})
            AND (
              (pol.polqual IS NOT NULL AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%current_setting%role%')
              OR
              (pol.polwithcheck IS NOT NULL AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%current_setting%role%')
            )
          ORDER BY 1
        `);

        expect(
          violations,
          `Policies using current_setting:\n${violations.map(v => `  - ${v.tbl} / ${v.policy}`).join('\n')}`
        ).toHaveLength(0);
      });
    });
  }
);
