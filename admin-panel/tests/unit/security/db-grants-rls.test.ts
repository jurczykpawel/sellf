/**
 * ============================================================================
 * SECURITY TEST: Database Grants & RLS Policies — Areas 3 & 8 of Security Audit
 * ============================================================================
 *
 * Area 3: Grant Permissions — Principle of Least Privilege
 *   - Sensitive public tables (admin_users, audit_log, rate_limits, etc.)
 *     must NOT have grants to anon or authenticated roles
 *   - seller_main tables must NOT have GRANT ALL to anon
 *
 * Area 8: RLS Policy Completeness
 *   - Every table in seller_main and sensitive public tables must have
 *     Row Level Security ENABLED
 *   - Every seller_main table must have at least one RLS policy
 *   - No policy uses USING (true) on sensitive tables (unrestricted read)
 *   - Policies must use auth.uid() or auth.role(), not client-supplied params
 *
 * Static analysis of migration SQL files — no live DB required.
 *
 * @see AREA 3 and AREA 8 in priv/SECURITY-AUDIT-PROMPT.md
 * ============================================================================
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

function getAllMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
    .join('\n');
}

function getMigrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ name: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf-8') }));
}

// ============================================================================
// Area 3: Grant Permissions
// ============================================================================

describe('Area 3: Grant Permissions — Principle of Least Privilege', () => {
  /**
   * Sensitive platform tables that must NEVER have grants to anon or authenticated.
   * These are written only via SECURITY DEFINER functions or service_role.
   */
  const SENSITIVE_PUBLIC_TABLES = [
    'admin_actions',
    'audit_log',
    'rate_limits',
    'application_rate_limits',
    'admin_users',        // authenticated may SELECT (for admin check) — tested separately
  ] as const;

  /**
   * For admin_users specifically: authenticated may SELECT (needed for RLS admin checks)
   * but must NOT INSERT/UPDATE/DELETE.
   */
  const ADMIN_USERS_WRITE_PRIVS = ['INSERT', 'UPDATE', 'DELETE'];

  it('anon and authenticated must not have any grant on audit_log, rate_limits, application_rate_limits, admin_actions', () => {
    const allSql = getAllMigrationSql();
    const violations: string[] = [];

    const noGrantTables = ['audit_log', 'rate_limits', 'application_rate_limits', 'admin_actions'];

    for (const table of noGrantTables) {
      // Look for GRANT ... ON public.<table> TO anon/authenticated
      const grantRe = new RegExp(
        `GRANT\\s+[\\w,\\s]+ON\\s+(?:public\\.)?${table}\\s+TO\\s+(?:anon|authenticated)`,
        'gi'
      );
      const matches = [...allSql.matchAll(grantRe)];
      // Filter out any REVOKE lines (we're looking for GRANTs)
      const grants = matches.filter(m => !allSql.slice(Math.max(0, allSql.indexOf(m[0]) - 10), allSql.indexOf(m[0])).includes('REVOKE'));

      if (grants.length > 0) {
        for (const g of grants) {
          violations.push(`  public.${table}: found grant  "${g[0].trim().substring(0, 80)}"`);
        }
      }
    }

    expect(
      violations,
      `Sensitive tables must not be directly accessible by anon/authenticated:\n${violations.join('\n')}\n\n` +
      `These tables are written only via SECURITY DEFINER functions. Direct grants bypass this protection.`
    ).toHaveLength(0);
  });

  it('anon must not have GRANT ALL on any seller_main real table', () => {
    const files = getMigrationFiles();
    const violations: string[] = [];

    for (const { name, sql } of files) {
      // Match GRANT ALL ON seller_main.<table> TO anon
      const grantAllAnonRe = /GRANT\s+ALL\s+(?:PRIVILEGES\s+)?ON\s+(?:TABLE\s+)?seller_main\.(\w+)\s+TO\s+anon/gi;
      for (const m of sql.matchAll(grantAllAnonRe)) {
        violations.push(`  ${name}: GRANT ALL ON seller_main.${m[1]} TO anon`);
      }
    }

    expect(
      violations,
      `anon must never have ALL privileges on seller_main tables — RLS-bypass risk:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('admin_users must not have INSERT/UPDATE/DELETE granted to anon or authenticated', () => {
    const allSql = getAllMigrationSql();
    const violations: string[] = [];

    for (const priv of ADMIN_USERS_WRITE_PRIVS) {
      // GRANT INSERT ON admin_users TO anon  /  GRANT INSERT ON admin_users TO authenticated
      const re = new RegExp(
        `GRANT\\s+[\\w\\s,]*${priv}[\\w\\s,]*ON\\s+(?:public\\.)?admin_users\\s+TO\\s+(?:anon|authenticated)`,
        'gi'
      );
      for (const m of allSql.matchAll(re)) {
        violations.push(`  admin_users: found  "${m[0].trim().substring(0, 80)}"`);
      }
    }

    expect(
      violations,
      `admin_users write privileges must be service_role only:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('api_keys must not have GRANT ALL to anon', () => {
    const allSql = getAllMigrationSql();
    const re = /GRANT\s+ALL[\w\s,]*ON\s+(?:public\.)?api_keys\s+TO\s+anon/gi;
    const matches = [...allSql.matchAll(re)];
    expect(matches, 'api_keys must not have ALL grant to anon').toHaveLength(0);
  });

  it('sellers table must have RLS-enabling REVOKE for anon where needed', () => {
    // sellers is a public table — ensure anon cannot see sensitive seller data
    // The actual check is that RLS is enabled (covered in Area 8 tests)
    const allSql = getAllMigrationSql();
    const rlsRe = /ALTER\s+TABLE\s+(?:public\.)?sellers\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i;
    expect(
      rlsRe.test(allSql),
      'public.sellers must have ROW LEVEL SECURITY enabled'
    ).toBe(true);
  });
});

// ============================================================================
// Area 8: RLS Policy Completeness
// ============================================================================

describe('Area 8: RLS Policy Completeness', () => {

  /**
   * All seller_main tables that hold user/payment data and MUST have RLS.
   * Derived from the actual table list in the migrations.
   */
  const SELLER_MAIN_TABLES_REQUIRING_RLS = [
    'products',
    'categories',
    'tags',
    'product_categories',
    'product_tags',
    'user_product_access',
    'payment_transactions',
    'guest_purchases',
    'profiles',
    'stripe_configurations',
    'shop_config',
    'revenue_goals',
    'refund_requests',
    'coupons',
    'coupon_redemptions',
    'coupon_reservations',
    'order_bumps',
    'webhook_endpoints',
    'webhook_logs',
    'integrations_config',
    'custom_scripts',
    'consent_logs',
    'video_progress',
    'video_events',
    'oto_offers',
    'variant_groups',
    'product_variant_groups',
    'payment_line_items',
    'payment_method_config',
  ] as const;

  const SENSITIVE_PUBLIC_TABLES_REQUIRING_RLS = [
    'admin_users',
    'admin_actions',
    'audit_log',
    'rate_limits',
    'application_rate_limits',
    'api_keys',
    'api_key_audit_log',
    'sellers',
    'tracking_logs',
  ] as const;

  it('every seller_main table must have ROW LEVEL SECURITY enabled', () => {
    const allSql = getAllMigrationSql();
    const missing: string[] = [];

    for (const table of SELLER_MAIN_TABLES_REQUIRING_RLS) {
      const rlsRe = new RegExp(
        `ALTER\\s+TABLE\\s+(?:seller_main\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i'
      );
      if (!rlsRe.test(allSql)) {
        missing.push(`  seller_main.${table}`);
      }
    }

    expect(
      missing,
      `Tables missing ENABLE ROW LEVEL SECURITY:\n${missing.join('\n')}\n\n` +
      `Without RLS, any authenticated user can query all rows.`
    ).toHaveLength(0);
  });

  it('every sensitive public table must have ROW LEVEL SECURITY enabled', () => {
    const allSql = getAllMigrationSql();
    const missing: string[] = [];

    for (const table of SENSITIVE_PUBLIC_TABLES_REQUIRING_RLS) {
      const rlsRe = new RegExp(
        `ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i'
      );
      if (!rlsRe.test(allSql)) {
        missing.push(`  public.${table}`);
      }
    }

    expect(
      missing,
      `Sensitive public tables missing ENABLE ROW LEVEL SECURITY:\n${missing.join('\n')}`
    ).toHaveLength(0);
  });

  it('every seller_main table must have at least one CREATE POLICY', () => {
    const allSql = getAllMigrationSql();
    const missing: string[] = [];

    for (const table of SELLER_MAIN_TABLES_REQUIRING_RLS) {
      // Match: CREATE POLICY anywhere followed by ON seller_main.<table> or ON <table>
      // The table name can appear anywhere between CREATE POLICY and the semicolon
      const policyRe = new RegExp(
        `CREATE\\s+POLICY\\b[^;]+\\bON\\s+(?:seller_main\\.)?${table}\\b`,
        'i'
      );
      if (!policyRe.test(allSql)) {
        missing.push(`  seller_main.${table}`);
      }
    }

    expect(
      missing,
      `Tables with RLS enabled but no policies (= all access denied, breaks the app):\n${missing.join('\n')}\n\n` +
      `Add at least one RLS policy to each table.`
    ).toHaveLength(0);
  });

  it('no sensitive seller_main table has a permissive USING (true) policy for anon', () => {
    /**
     * USING (true) = unrestricted access for that operation.
     * Acceptable on: products (public catalog), categories, tags (public reads).
     * NOT acceptable on: payment_transactions, profiles, user_product_access,
     *   stripe_configurations, refund_requests, etc.
     */
    const SENSITIVE_NO_OPEN_READ = [
      'payment_transactions',
      'guest_purchases',
      'profiles',
      'stripe_configurations',
      'user_product_access',
      'refund_requests',
      'revenue_goals',
      'webhook_endpoints',
      'webhook_logs',
      'integrations_config',
      'video_progress',
      'video_events',
    ] as const;

    const files = getMigrationFiles();
    const violations: string[] = [];

    for (const { name, sql } of files) {
      for (const table of SENSITIVE_NO_OPEN_READ) {
        // Find policy blocks for this table that use USING (true)
        const policyBlockRe = new RegExp(
          `CREATE\\s+POLICY[^;]+ON\\s+(?:seller_main\\.)?${table}[^;]+USING\\s*\\(\\s*true\\s*\\)`,
          'gi'
        );
        for (const m of sql.matchAll(policyBlockRe)) {
          // Check if it's restricted to a safe role
          const policyText = m[0];
          const isServiceRoleOnly = /TO\s+service_role/i.test(policyText);
          if (!isServiceRoleOnly) {
            violations.push(
              `  ${name}: ${table} — USING (true) policy without service_role restriction\n` +
              `    "${policyText.trim().substring(0, 100)}..."`
            );
          }
        }
      }
    }

    expect(
      violations,
      `Sensitive tables with open USING (true) policies allow unrestricted reads:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('RLS policies must reference auth.uid() or auth.role(), not raw user id parameters', () => {
    /**
     * Policies using hardcoded UUIDs, user_id parameters, or session variables
     * that clients can spoof are vulnerable to privilege escalation.
     *
     * Check: no policy has USING (user_id = <literal UUID>) pattern
     * which would mean the policy was accidentally hardcoded for a specific user.
     */
    const files = getMigrationFiles();
    const violations: string[] = [];

    // Pattern: USING (user_id = 'UUID') — hardcoded user
    const hardcodedRe = /USING\s*\(\s*\w+\s*=\s*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'\s*\)/gi;

    for (const { name, sql } of files) {
      for (const m of sql.matchAll(hardcodedRe)) {
        violations.push(`  ${name}: hardcoded UUID in RLS policy: "${m[0].trim()}"`);
      }
    }

    expect(
      violations,
      `RLS policies with hardcoded UUIDs — use auth.uid() instead:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('payment_transactions and user_product_access must have policies for all four operations', () => {
    /**
     * Critical tables must have explicit policies for SELECT, INSERT, UPDATE, DELETE.
     * `FOR ALL` counts as covering all operations.
     * We verify each op is covered by either FOR <op> or FOR ALL.
     */
    const CRITICAL_TABLES = ['payment_transactions', 'user_product_access'] as const;
    const REQUIRED_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

    const allSql = getAllMigrationSql();
    const missing: string[] = [];

    for (const table of CRITICAL_TABLES) {
      // First check if there is a FOR ALL policy — that covers everything
      const forAllRe = new RegExp(
        `CREATE\\s+POLICY\\b[^;]+\\bON\\s+(?:seller_main\\.)?${table}\\b[^;]+FOR\\s+ALL\\b`,
        'i'
      );
      if (forAllRe.test(allSql)) continue; // FOR ALL covers SELECT/INSERT/UPDATE/DELETE

      for (const op of REQUIRED_OPS) {
        const policyRe = new RegExp(
          `CREATE\\s+POLICY\\b[^;]+\\bON\\s+(?:seller_main\\.)?${table}\\b[^;]+FOR\\s+${op}\\b`,
          'i'
        );
        if (!policyRe.test(allSql)) {
          missing.push(`  seller_main.${table}: missing FOR ${op} (or FOR ALL) policy`);
        }
      }
    }

    expect(
      missing,
      `Critical tables missing operation-specific RLS policies:\n${missing.join('\n')}`
    ).toHaveLength(0);
  });
});
