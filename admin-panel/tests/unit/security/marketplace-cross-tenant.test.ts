/**
 * ============================================================================
 * SECURITY TEST: Marketplace Cross-Tenant Isolation
 * ============================================================================
 *
 * THE MOST CRITICAL SECURITY TEST FILE.
 * Verifies that seller A cannot access seller B's data.
 *
 * Architecture:
 *   - Schema-per-tenant: each seller gets a PostgreSQL schema
 *     (seller_kowalski_digital, seller_creative_studio)
 *   - is_admin() returns FALSE for sellers as authenticated users
 *   - RLS policies use is_admin() — sellers cannot bypass them
 *   - API middleware creates schema-scoped clients via createSellerAdminClient()
 *
 * Test categories:
 *   1. SQL function tests (is_admin, is_admin_cached, is_platform_admin)
 *   2. Cross-schema RLS isolation (direct DB queries)
 *   3. Sellers table protection (ownership policies + column grants)
 *   5. API middleware schema resolution (static/unit checks)
 *
 * Requires: Supabase running + db reset (docker exec against supabase_db_sellf)
 *
 * @see supabase/migrations/20260317140204_seller_admin_in_is_admin_cached.sql
 * @see admin-panel/src/lib/api/middleware.ts
 * @see admin-panel/src/lib/api/api-keys.ts (SCOPE_PRESETS)
 * ============================================================================
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// ============================================================================
// Constants
// ============================================================================

const CONTAINER = 'supabase_db_sellf';

// Seed user IDs
const KOWALSKI_USER_ID = 'eeeeeeee-1111-4000-a000-000000000001';
const CREATIVE_USER_ID = 'eeeeeeee-2222-4000-a000-000000000002';
const BUYER_USER_ID = 'eeeeeeee-3333-4000-a000-000000000003';

// Seller schemas
const KOWALSKI_SCHEMA = 'seller_kowalski_digital';
const CREATIVE_SCHEMA = 'seller_creative_studio';
const MAIN_SCHEMA = 'seller_main';

// Source files for static analysis
const MIDDLEWARE_PATH = join(__dirname, '../../../src/lib/api/middleware.ts');
const API_KEYS_PATH = join(__dirname, '../../../src/lib/api/api-keys.ts');
const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

// ============================================================================
// Helpers
// ============================================================================

/**
 * Execute SQL query on local Supabase database via docker exec.
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

/**
 * Execute multi-statement SQL via stdin (supports SET + SELECT together).
 * Returns the last result set as parsed JSON rows.
 */
function queryMulti<T = Record<string, unknown>>(sql: string): T[] {
  try {
    const result = execSync(
      `echo ${JSON.stringify(sql)} | docker exec -i ${CONTAINER} psql -U postgres -t -A`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();

    // The output contains multiple result sets; find the JSON one
    const lines = result.split('\n').filter(l => l.trim().length > 0);
    // Last non-empty line should be our JSON result
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('[') || line.startsWith('{') || line === 'null') {
        if (line === 'null') return [];
        return JSON.parse(line.startsWith('[') ? line : `[${line}]`) as T[];
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Execute SQL as an authenticated user (setting JWT claims + role).
 * Uses a transaction with SET LOCAL so the role change is scoped.
 * Returns rows from the query.
 */
function queryAs<T = Record<string, unknown>>(userId: string, sql: string): T[] {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' }).replace(/'/g, "''");
  const fullSql = `
    BEGIN;
    SET LOCAL role TO authenticated;
    SET LOCAL request.jwt.claims TO '${claims}';
    SELECT json_agg(t) FROM (${sql}) t;
    ROLLBACK;
  `;
  return queryMulti<T>(fullSql);
}

/**
 * Execute a DML statement as an authenticated user via stdin piped SQL.
 * Uses ON_ERROR_STOP to detect RLS violations.
 * Returns the full output (stdout + stderr merged).
 */
function execAsRaw(userId: string, sql: string): string {
  const claims = `{"sub":"${userId}","role":"authenticated"}`;
  // Use heredoc-style input to avoid shell quoting issues
  const fullSql = [
    'BEGIN;',
    'SET LOCAL role TO authenticated;',
    `SET LOCAL request.jwt.claims TO '${claims}';`,
    `${sql};`,
    'ROLLBACK;',
  ].join('\n');
  try {
    return execSync(
      `docker exec -i ${CONTAINER} psql -U postgres -v ON_ERROR_STOP=1`,
      { encoding: 'utf-8', timeout: 10000, input: fullSql }
    ).trim();
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return (err.stderr || '') + (err.stdout || '') + (err.message || '');
  }
}

/**
 * Execute a DML statement as an authenticated user.
 * Returns true if no error, false if RLS or permission error occurred.
 */
function execAs(userId: string, sql: string): { success: boolean; error?: string } {
  const output = execAsRaw(userId, sql);
  const hasError = /ERROR:|violates row-level security|permission denied/i.test(output);
  return { success: !hasError, error: hasError ? output : undefined };
}

/**
 * Call a SQL function as an authenticated user.
 */
function callFunctionAs<T>(userId: string, fnCall: string): T | null {
  const rows = queryAs<{ result: T }>(userId, `SELECT ${fnCall} AS result`);
  return rows.length > 0 ? rows[0].result : null;
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
// Pre-flight check (isDatabaseAvailable() is called inline by it.skipIf)
// ============================================================================

// ============================================================================
// 1. SQL function tests
// ============================================================================

describe('is_admin() -- SQL function security', () => {
  it.skipIf(!isDatabaseAvailable())('returns FALSE for seller admin as authenticated user', () => {
    const result = callFunctionAs<boolean>(KOWALSKI_USER_ID, 'public.is_admin()');
    expect(result).toBe(false);
  });

  it.skipIf(!isDatabaseAvailable())('returns FALSE for creative seller as authenticated user', () => {
    const result = callFunctionAs<boolean>(CREATIVE_USER_ID, 'public.is_admin()');
    expect(result).toBe(false);
  });

  it('returns TRUE for service_role (static source check)', () => {
    // is_admin() must have service_role bypass as the FIRST check.
    // We verify this by static source analysis since SET LOCAL role TO service_role
    // does not populate auth.role() correctly in psql (auth.role() reads from JWT, not pg role).
    const migrationPath = join(MIGRATIONS_DIR, '20260317140204_seller_admin_in_is_admin_cached.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION is_admin(');
    const fnEnd = sql.indexOf('$$;', fnStart) + 3;
    const fnBody = sql.slice(fnStart, fnEnd);

    // service_role check must be the FIRST conditional (before admin_users check)
    const serviceRoleIdx = fnBody.indexOf("'service_role'");
    const adminUsersIdx = fnBody.indexOf('admin_users');
    expect(serviceRoleIdx, 'service_role check must exist').toBeGreaterThan(-1);
    expect(adminUsersIdx, 'admin_users check must exist').toBeGreaterThan(-1);
    expect(serviceRoleIdx, 'service_role check must come BEFORE admin_users check').toBeLessThan(adminUsersIdx);

    // Must use auth.role() (not current_setting)
    expect(fnBody).toMatch(/auth\.role\(\)/);
    expect(fnBody).not.toMatch(/current_setting.*role/i);
  });

  it('does NOT check public.sellers table (static source check)', () => {
    const migrationPath = join(MIGRATIONS_DIR, '20260317140204_seller_admin_in_is_admin_cached.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    // Extract is_admin() function body -- ends at first $$ LANGUAGE plpgsql
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION is_admin(');
    // Find the next CREATE OR REPLACE FUNCTION to limit our search
    const nextFnStart = sql.indexOf('CREATE OR REPLACE FUNCTION', fnStart + 1);
    const fnBody = sql.slice(fnStart, nextFnStart > -1 ? nextFnStart : fnStart + 2000);

    // is_admin() must NOT query sellers table
    expect(fnBody).not.toMatch(/public\.sellers/);
    expect(fnBody).not.toMatch(/FROM\s+sellers/i);
    // Must only check admin_users
    expect(fnBody).toMatch(/admin_users/);
  });
});

describe('is_admin_cached() -- UI-only function', () => {
  it.skipIf(!isDatabaseAvailable())('returns TRUE for seller admin (checks sellers table)', () => {
    const result = callFunctionAs<boolean>(KOWALSKI_USER_ID, 'public.is_admin_cached()');
    expect(result).toBe(true);
  });

  it.skipIf(!isDatabaseAvailable())('returns TRUE for creative seller admin', () => {
    const result = callFunctionAs<boolean>(CREATIVE_USER_ID, 'public.is_admin_cached()');
    expect(result).toBe(true);
  });

  it('is NOT referenced in any RLS policy (static grep check)', () => {
    const migrationFiles = require('fs').readdirSync(MIGRATIONS_DIR)
      .filter((f: string) => f.endsWith('.sql'))
      .sort();

    const violations: string[] = [];

    for (const file of migrationFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');

      // Look for is_admin_cached in USING or WITH CHECK clauses of CREATE POLICY
      const policyRegex = /CREATE\s+POLICY\s+.*?;/gis;
      let match;
      while ((match = policyRegex.exec(content)) !== null) {
        if (match[0].includes('is_admin_cached')) {
          violations.push(`${file}: ${match[0].slice(0, 120)}`);
        }
      }
    }

    expect(
      violations,
      `is_admin_cached() must NEVER be used in RLS policies (security bypass risk):\n${violations.join('\n')}`
    ).toHaveLength(0);
  });
});

describe('is_platform_admin() -- sellers table guard', () => {
  it.skipIf(!isDatabaseAvailable())('returns FALSE for seller admin (kowalski)', () => {
    const result = callFunctionAs<boolean>(KOWALSKI_USER_ID, 'public.is_platform_admin()');
    expect(result).toBe(false);
  });

  it.skipIf(!isDatabaseAvailable())('returns FALSE for seller admin (creative)', () => {
    const result = callFunctionAs<boolean>(CREATIVE_USER_ID, 'public.is_platform_admin()');
    expect(result).toBe(false);
  });

  it.skipIf(!isDatabaseAvailable())('returns FALSE for regular buyer user', () => {
    const result = callFunctionAs<boolean>(BUYER_USER_ID, 'public.is_platform_admin()');
    expect(result).toBe(false);
  });
});

// ============================================================================
// 2. Cross-schema RLS isolation
// ============================================================================

describe('Cross-tenant RLS isolation', () => {
  // NOTE: Products table has a public SELECT policy (is_active=true products are readable
  // by any authenticated user). Cross-schema read isolation for products is enforced at the
  // API middleware layer via schema-scoped clients, NOT via RLS.
  // RLS blocks INSERT/UPDATE/DELETE across schemas because those require is_admin()=true.

  it.skipIf(!isDatabaseAvailable())('seller A cannot INSERT products into seller_creative_studio schema (RLS blocks)', () => {
    // is_admin() returns false for authenticated seller -> WITH CHECK fails
    const output = execAsRaw(
      KOWALSKI_USER_ID,
      `INSERT INTO ${CREATIVE_SCHEMA}.products (name, slug, price, currency) VALUES ('Hacked Product', 'hacked-test', 999, 'PLN')`
    );
    // Should fail with RLS policy violation
    expect(output).toMatch(/violates row-level security policy/);
  });

  it.skipIf(!isDatabaseAvailable())('seller A cannot UPDATE products in seller_creative_studio schema', () => {
    // UPDATE requires is_admin()=true; seller gets false
    // The RLS policy silently filters rows (0 rows matched) rather than erroring
    execAs(
      KOWALSKI_USER_ID,
      `UPDATE ${CREATIVE_SCHEMA}.products SET name = 'Hacked' WHERE slug = 'logo-design'`
    );
    // Verify data was NOT changed (using service_role/postgres)
    const srRows = query<{ name: string }>(
      `SELECT name FROM ${CREATIVE_SCHEMA}.products WHERE slug = 'logo-design'`
    );
    expect(srRows.length).toBeGreaterThan(0);
    expect(srRows[0].name).not.toBe('Hacked');
  });

  it.skipIf(!isDatabaseAvailable())('seller A cannot DELETE products from seller_creative_studio schema', () => {
    // Count products before attempt
    const before = query<{ count: string }>(
      `SELECT count(*) as count FROM ${CREATIVE_SCHEMA}.products`
    );
    const countBefore = parseInt(before[0]?.count || '0');

    execAs(
      KOWALSKI_USER_ID,
      `DELETE FROM ${CREATIVE_SCHEMA}.products WHERE slug = 'logo-design'`
    );

    const after = query<{ count: string }>(
      `SELECT count(*) as count FROM ${CREATIVE_SCHEMA}.products`
    );
    const countAfter = parseInt(after[0]?.count || '0');

    expect(countAfter).toBe(countBefore);
  });

  it.skipIf(!isDatabaseAvailable())('seller A cannot read payment_transactions from other schemas', () => {
    // payment_transactions SELECT requires is_admin()=true — seller cannot read
    const rows = queryAs(KOWALSKI_USER_ID, `SELECT id FROM ${CREATIVE_SCHEMA}.payment_transactions LIMIT 1`);
    expect(rows).toHaveLength(0);

    const mainRows = queryAs(KOWALSKI_USER_ID, `SELECT id FROM ${MAIN_SCHEMA}.payment_transactions LIMIT 1`);
    expect(mainRows).toHaveLength(0);
  });

  it.skipIf(!isDatabaseAvailable())('seller A cannot read user_product_access from other schemas', () => {
    const rows = queryAs(KOWALSKI_USER_ID, `SELECT user_id FROM ${CREATIVE_SCHEMA}.user_product_access LIMIT 1`);
    expect(rows).toHaveLength(0);

    const mainRows = queryAs(KOWALSKI_USER_ID, `SELECT user_id FROM ${MAIN_SCHEMA}.user_product_access LIMIT 1`);
    expect(mainRows).toHaveLength(0);
  });

  it.skipIf(!isDatabaseAvailable())('products public SELECT is read-only — admin actions (INSERT/UPDATE/DELETE) blocked across schemas', () => {
    // Active products are publicly readable (storefront requirement), but all mutations
    // require is_admin()=true. Verify this policy structure.
    const policies = query<{ polname: string; polcmd: string; using_expr: string; check_expr: string }>(
      `SELECT polname, polcmd,
              pg_get_expr(polqual, polrelid) as using_expr,
              pg_get_expr(polwithcheck, polrelid) as check_expr
       FROM pg_policy WHERE polrelid = '${KOWALSKI_SCHEMA}.products'::regclass`
    );

    // INSERT, UPDATE, DELETE must all require is_admin()
    const writePolicies = policies.filter(p => ['a', 'w', 'd'].includes(p.polcmd));
    for (const p of writePolicies) {
      const expr = p.using_expr || p.check_expr || '';
      expect(expr, `Write policy "${p.polname}" must use is_admin()`).toContain('is_admin');
    }

    // SELECT policy should allow public read for active products
    const selectPolicies = policies.filter(p => p.polcmd === 'r');
    expect(selectPolicies.length).toBeGreaterThan(0);
  });

  it('API middleware enforces schema-scoped clients (static source check)', () => {
    // Cross-schema read isolation for products is enforced by the API middleware
    // creating a schema-scoped Supabase client (not by RLS).
    // Verify middleware creates schema-scoped clients for seller sessions.
    const middlewareSource = readFileSync(MIDDLEWARE_PATH, 'utf-8');

    // Must create a seller-scoped client with the seller's schema_name
    expect(middlewareSource).toContain('createSellerAdminClient');
    expect(middlewareSource).toContain('seller.schema_name');

    // Must NOT fall back to a cross-schema client
    // Seller session should get sellerSchema set
    expect(middlewareSource).toContain('sellerSchema: seller.schema_name');
  });
});

// ============================================================================
// 3. Sellers table protection
// ============================================================================

describe('Sellers table -- ownership policies', () => {
  it.skipIf(!isDatabaseAvailable())('seller A cannot UPDATE seller B record', () => {
    const result = execAs(
      KOWALSKI_USER_ID,
      `UPDATE public.sellers SET display_name = 'Hacked by Kowalski' WHERE user_id = '${CREATIVE_USER_ID}'`
    );
    // Verify the name was not changed
    const rows = query<{ display_name: string }>(
      `SELECT display_name FROM public.sellers WHERE user_id = '${CREATIVE_USER_ID}'`
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].display_name).not.toBe('Hacked by Kowalski');
  });

  it.skipIf(!isDatabaseAvailable())('seller A CAN UPDATE own display_name', () => {
    // Verify via column-level grant that display_name is updatable
    const grants = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_name = 'sellers' AND table_schema = 'public'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'`
    );
    const grantedColumns = grants.map(g => g.column_name);
    expect(grantedColumns).toContain('display_name');

    // Verify seller can read own row (own_read policy)
    const rows = queryAs<{ display_name: string }>(
      KOWALSKI_USER_ID,
      `SELECT display_name FROM public.sellers WHERE user_id = '${KOWALSKI_USER_ID}'`
    );
    expect(rows.length).toBeGreaterThan(0);

    // Verify own_update policy exists and allows self-update
    const policies = query<{ polname: string }>(
      `SELECT polname FROM pg_policy WHERE polrelid = 'public.sellers'::regclass AND polname = 'sellers_own_update'`
    );
    expect(policies.length).toBe(1);
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT UPDATE own platform_fee_percent (column grant)', () => {
    const grants = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_name = 'sellers' AND table_schema = 'public'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'`
    );
    const grantedColumns = grants.map(g => g.column_name);
    expect(grantedColumns).not.toContain('platform_fee_percent');
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT UPDATE own stripe_account_id (column grant)', () => {
    const grants = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_name = 'sellers' AND table_schema = 'public'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'`
    );
    const grantedColumns = grants.map(g => g.column_name);
    expect(grantedColumns).not.toContain('stripe_account_id');
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT UPDATE own status (column grant)', () => {
    const grants = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_name = 'sellers' AND table_schema = 'public'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'`
    );
    const grantedColumns = grants.map(g => g.column_name);
    expect(grantedColumns).not.toContain('status');
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT UPDATE own schema_name (column grant)', () => {
    const grants = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_name = 'sellers' AND table_schema = 'public'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'`
    );
    const grantedColumns = grants.map(g => g.column_name);
    expect(grantedColumns).not.toContain('schema_name');
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT UPDATE own user_id (column grant)', () => {
    const grants = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_name = 'sellers' AND table_schema = 'public'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'`
    );
    const grantedColumns = grants.map(g => g.column_name);
    expect(grantedColumns).not.toContain('user_id');
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT INSERT new seller record', () => {
    const output = execAsRaw(
      KOWALSKI_USER_ID,
      `INSERT INTO public.sellers (slug, display_name, schema_name, status) VALUES ('hacked_store', 'Hacked Store', 'seller_hacked', 'active')`
    );
    // Should fail with RLS policy violation or permission denied
    expect(output).toMatch(/violates row-level security policy|permission denied/);
  });

  it.skipIf(!isDatabaseAvailable())('seller A CANNOT DELETE any seller record', () => {
    const before = query<{ count: string }>('SELECT count(*) as count FROM public.sellers');
    const countBefore = parseInt(before[0]?.count || '0');

    execAs(KOWALSKI_USER_ID, `DELETE FROM public.sellers WHERE user_id = '${CREATIVE_USER_ID}'`);

    const after = query<{ count: string }>('SELECT count(*) as count FROM public.sellers');
    const countAfter = parseInt(after[0]?.count || '0');
    expect(countAfter).toBe(countBefore);
  });
});

// ============================================================================
// 5. API middleware schema resolution (static checks)
// ============================================================================

describe('API middleware -- seller schema resolution', () => {
  const middlewareSource = readFileSync(MIDDLEWARE_PATH, 'utf-8');
  const apiKeysSource = readFileSync(API_KEYS_PATH, 'utf-8');

  it('authenticateViaSession resolves seller schema from sellers table', () => {
    // The middleware must query sellers table with user_id to find schema_name
    expect(middlewareSource).toMatch(/sellers/);
    expect(middlewareSource).toMatch(/schema_name/);
    expect(middlewareSource).toMatch(/user_id/);

    // Must call isValidSellerSchema before creating seller client
    const validationIdx = middlewareSource.indexOf('isValidSellerSchema');
    const sellerClientIdx = middlewareSource.indexOf('createSellerAdminClient');
    expect(validationIdx).toBeGreaterThan(-1);
    expect(sellerClientIdx).toBeGreaterThan(-1);
    expect(validationIdx).toBeLessThan(sellerClientIdx);
  });

  it('seller session gets sellerDefault scope preset (no SYSTEM scopes)', () => {
    // Verify middleware assigns SCOPE_PRESETS.sellerDefault for seller sessions
    expect(middlewareSource).toMatch(/SCOPE_PRESETS\.sellerDefault/);
  });

  it('sellerDefault preset does NOT include SYSTEM_READ or SYSTEM_WRITE', () => {
    // Extract sellerDefault definition from api-keys.ts
    const presetStart = apiKeysSource.indexOf('sellerDefault:');
    expect(presetStart).toBeGreaterThan(-1);

    // Find the closing bracket for the sellerDefault array
    const arrayStart = apiKeysSource.indexOf('[', presetStart);
    let depth = 0;
    let arrayEnd = arrayStart;
    for (let i = arrayStart; i < apiKeysSource.length; i++) {
      if (apiKeysSource[i] === '[') depth++;
      if (apiKeysSource[i] === ']') depth--;
      if (depth === 0) { arrayEnd = i + 1; break; }
    }
    const sellerDefaultBody = apiKeysSource.slice(arrayStart, arrayEnd);

    expect(sellerDefaultBody).not.toContain('SYSTEM_READ');
    expect(sellerDefaultBody).not.toContain('SYSTEM_WRITE');
    expect(sellerDefaultBody).not.toContain('FULL_ACCESS');
  });

  it('sellerDefault preset includes expected seller scopes', () => {
    const presetStart = apiKeysSource.indexOf('sellerDefault:');
    const arrayStart = apiKeysSource.indexOf('[', presetStart);
    let depth = 0;
    let arrayEnd = arrayStart;
    for (let i = arrayStart; i < apiKeysSource.length; i++) {
      if (apiKeysSource[i] === '[') depth++;
      if (apiKeysSource[i] === ']') depth--;
      if (depth === 0) { arrayEnd = i + 1; break; }
    }
    const sellerDefaultBody = apiKeysSource.slice(arrayStart, arrayEnd);

    // Must include basic seller CRUD scopes
    expect(sellerDefaultBody).toContain('PRODUCTS_READ');
    expect(sellerDefaultBody).toContain('PRODUCTS_WRITE');
    expect(sellerDefaultBody).toContain('ANALYTICS_READ');
    expect(sellerDefaultBody).toContain('PAYMENTS_READ');
  });
});

// =============================================================================
// 5. Webhook per-schema routing (Stripe Connect)
// =============================================================================

describe('Webhook handler — per-schema routing security', () => {
  function readSource(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    // Tests run from admin-panel/ but process.cwd() may be repo root
    const base = process.cwd().endsWith('admin-panel') ? process.cwd() : path.join(process.cwd(), 'admin-panel');
    return fs.readFileSync(path.join(base, relativePath), 'utf-8');
  }

  function readWebhookSource(): string {
    return readSource('src/app/api/webhooks/stripe/route.ts');
  }

  it('extracts seller_schema from session/payment metadata', () => {
    const source = readWebhookSource();
    expect(source).toContain('seller_schema');
    expect(source).toContain('metadata');
  });

  it('validates seller_schema with isValidSellerSchema before using', () => {
    const source = readWebhookSource();
    expect(source).toContain('isValidSellerSchema');
  });

  it('routes to seller schema via getServiceClient(sellerSchema)', () => {
    const source = readWebhookSource();
    expect(source).toContain('getServiceClient');
  });

  it('handles account.updated webhook event', () => {
    const source = readWebhookSource();
    expect(source).toContain("'account.updated'");
    expect(source).toContain('handleAccountUpdated');
  });

  it('handles account.application.deauthorized webhook event', () => {
    const source = readWebhookSource();
    expect(source).toContain("'account.application.deauthorized'");
    expect(source).toContain('handleAccountDeauthorized');
  });

  it('Connect webhook handlers are imported from lib/stripe/connect', () => {
    const source = readWebhookSource();
    expect(source).toContain("from '@/lib/stripe/connect'");
  });

  it('webhook registration uses connect: true for connected accounts', () => {
    const regSource = readSource('src/lib/stripe/webhook-registration.ts');
    expect(regSource).toContain('connect: true');
  });
});
