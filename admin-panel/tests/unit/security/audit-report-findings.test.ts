/**
 * ============================================================================
 * SECURITY TEST: SQL & TypeScript Security Hardening
 * ============================================================================
 *
 * Static analysis tests verifying security rules are enforced across
 * SQL migrations and TypeScript source files. No live DB, no network.
 *
 * @see CLAUDE.md → "Supabase/PostgreSQL Security Rules"
 * ============================================================================
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// ============================================================================
// Helpers
// ============================================================================

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');
const SRC_DIR = join(__dirname, '../../../src');

function migration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
}

function allMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files.map(f => migration(f)).join('\n');
}

function src(relativePath: string): string {
  return readFileSync(join(SRC_DIR, relativePath), 'utf-8');
}

const ALL_SQL = allMigrations();

function extractPolicyBlocks(sql: string): { name: string; body: string }[] {
  const policies: { name: string; body: string }[] = [];
  const lines = sql.split('\n');
  let inPolicy = false;
  let currentBody = '';
  let currentName = '';

  for (const line of lines) {
    const policyStart = line.match(/CREATE POLICY\s+"([^"]+)"/i);
    if (policyStart) {
      inPolicy = true;
      currentName = policyStart[1];
      currentBody = line + '\n';
    } else if (inPolicy) {
      currentBody += line + '\n';
    }
    if (inPolicy && /;\s*$/.test(line)) {
      policies.push({ name: currentName, body: currentBody });
      inPolicy = false;
      currentBody = '';
      currentName = '';
    }
  }
  return policies;
}

function findPolicyAdminUsersViolations(sql: string): string[] {
  const lines = sql.split('\n');
  const violations: string[] = [];
  let inPolicy = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*CREATE POLICY\b/.test(line)) {
      inPolicy = true;
    }
    if (inPolicy) {
      if (/FROM public\.admin_users/.test(line)) {
        violations.push(`  line ${i + 1}: ${line.trim()}`);
      }
      if (/;\s*$/.test(line)) {
        inPolicy = false;
      }
    }
  }
  return violations;
}

/**
 * Extract all SECURITY DEFINER function blocks from SQL.
 * Returns function name and SET search_path value for each.
 */
function extractSecurityDefinerFunctions(
  sql: string
): { name: string; searchPath: string; hasSearchPath: boolean }[] {
  const results: { name: string; searchPath: string; hasSearchPath: boolean }[] = [];

  const funcRegex =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([^)]*\)[\s\S]*?SECURITY\s+DEFINER[\s\S]*?(?:SET\s+search_path\s*(?:=|TO)\s*'([^']*)'|AS\s+\$)/gi;

  let match;
  while ((match = funcRegex.exec(sql)) !== null) {
    const name = match[1];
    const searchPath = match[2] || '';
    results.push({
      name,
      searchPath,
      hasSearchPath: !!match[2],
    });
  }

  return results;
}

// ============================================================================
// RLS-A01: RLS policies must use is_admin() not direct table subqueries
// ============================================================================

describe('RLS-A01: RLS policies must use is_admin() function', () => {

  it('no RLS USING clause references admin_users directly', () => {
    const violations = findPolicyAdminUsersViolations(ALL_SQL);

    expect(
      violations,
      'Found RLS CREATE POLICY blocks with direct admin_users reference.\n' +
      'Use (select public.is_admin()) instead.\n' +
      'Violations:\n' + violations.join('\n')
    ).toHaveLength(0);
  });

  it('admin-check policies use the is_admin() function', () => {
    const usesIsAdmin = /public\.is_admin\(\)/.test(ALL_SQL);
    expect(usesIsAdmin, 'No RLS policies use public.is_admin()').toBe(true);
  });

  it('core_schema migration uses is_admin() in all policies', () => {
    const violations = findPolicyAdminUsersViolations(migration('20250101000000_core_schema.sql'));
    expect(violations, 'core_schema violations:\n' + violations.join('\n'))
      .toHaveLength(0);
  });

  it('features migration uses is_admin() in all policies', () => {
    const violations = findPolicyAdminUsersViolations(migration('20250103000000_features.sql'));
    expect(violations, 'features violations:\n' + violations.join('\n'))
      .toHaveLength(0);
  });

  it('marketplace_sellers migration uses is_admin() in all policies', () => {
    const violations = findPolicyAdminUsersViolations(migration('20260311000001_marketplace_sellers.sql'));
    expect(violations, 'marketplace_sellers violations:\n' + violations.join('\n'))
      .toHaveLength(0);
  });
});

// ============================================================================
// RLS-B01: All RLS-enabled tables must have at least one explicit policy
// ============================================================================

describe('RLS-B01: tables with RLS must have explicit policies', () => {
  it('tracking_logs has at least one CREATE POLICY', () => {
    const trackingLogsSql = migration('20260226000000_tracking_logs.sql');
    const hasPolicy = /CREATE POLICY\b.*\btracking_logs\b/i.test(ALL_SQL) ||
      /CREATE POLICY\b.*\btracking_logs\b/i.test(trackingLogsSql);
    expect(hasPolicy, 'tracking_logs: RLS enabled but no policies defined').toBe(true);
  });

  it('_migration_history has at least one CREATE POLICY', () => {
    const hasPolicy = /CREATE POLICY\b[^;]*\b_migration_history\b/i.test(ALL_SQL);
    expect(hasPolicy, '_migration_history: RLS enabled but no policies defined').toBe(true);
  });
});

// ============================================================================
// RLS-C01: INSERT policies must validate ownership
// ============================================================================

describe('RLS-C01: INSERT policies must validate ownership', () => {
  it('consent_logs INSERT policy validates user_id', () => {
    const policies = extractPolicyBlocks(ALL_SQL)
      .filter(p => /consent_logs/i.test(p.body) && /FOR INSERT/i.test(p.body));

    expect(policies.length).toBeGreaterThan(0);

    const nonServiceRolePolicies = policies.filter(p => !/TO\s+service_role/i.test(p.body));

    for (const p of nonServiceRolePolicies) {
      const hasBareTrue = /WITH\s+CHECK\s*\(\s*true\s*\)/i.test(p.body);
      expect(hasBareTrue, `Policy "${p.name}": INSERT WITH CHECK (true) without role restriction`).toBe(false);
    }
  });
});

// ============================================================================
// RLS-D01: Policies must use auth.role() not current_setting('role')
// ============================================================================

describe('RLS-D01: policies must use auth.role()', () => {
  it('no CREATE POLICY block uses current_setting(\'role\')', () => {
    const policies = extractPolicyBlocks(ALL_SQL);
    const violations = policies.filter(p =>
      /current_setting\s*\(\s*'role'/i.test(p.body)
    );
    expect(violations.length, 'Policies using current_setting instead of auth.role()').toBe(0);
  });
});

// ============================================================================
// RLS-E01: profiles must have INSERT and DELETE handling
// ============================================================================

describe('RLS-E01: profiles must have INSERT and DELETE handling', () => {
  it('profiles table has an INSERT or ALL policy', () => {
    const policies = extractPolicyBlocks(ALL_SQL)
      .filter(p =>
        /seller_main\.profiles\b|ON\s+profiles\b/i.test(p.body) &&
        (/FOR INSERT/i.test(p.body) || /FOR ALL/i.test(p.body))
      );
    expect(policies.length, 'profiles: no INSERT policy found').toBeGreaterThan(0);
  });

  it('profiles has a DELETE policy or DELETE is revoked', () => {
    const hasDeletePolicy = extractPolicyBlocks(ALL_SQL)
      .some(p =>
        /seller_main\.profiles\b/i.test(p.body) &&
        /FOR DELETE/i.test(p.body)
      );
    const hasRevokeDelete = /REVOKE\s+(?:ALL|DELETE)\s+ON\s+(?:TABLE\s+)?seller_main\.profiles\b/i.test(ALL_SQL);
    expect(hasDeletePolicy || hasRevokeDelete, 'profiles: no DELETE policy and DELETE not revoked').toBe(true);
  });
});

// ============================================================================
// GRANT-A01: Tables must REVOKE ALL before selective GRANT
// ============================================================================

describe('GRANT-A01: tables must REVOKE ALL before granting to anon', () => {

  it('sellers migration REVOKEs ALL before granting to anon', () => {
    const sql = migration('20260311000001_marketplace_sellers.sql');
    const revokePattern = /REVOKE ALL ON public\.sellers FROM anon/i;
    expect(revokePattern.test(sql), 'sellers: missing REVOKE ALL before GRANT').toBe(true);
  });

  it('anon gets only SELECT on public.sellers', () => {
    const sql = migration('20260311000001_marketplace_sellers.sql');
    const forbiddenGrant = /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)[^;]*sellers[^;]*TO\s+anon/i;
    expect(forbiddenGrant.test(sql), 'sellers: anon has more than SELECT').toBe(false);
  });
});

// ============================================================================
// GRANT-B01: No blanket default privileges for anon/authenticated
// ============================================================================

describe('GRANT-B01: default privileges must be explicit, not blanket', () => {
  it('no ALTER DEFAULT PRIVILEGES granting SELECT to anon in seller_main', () => {
    const coreSchema = migration('20250101000000_core_schema.sql');
    const blanketAnonSelect = /ALTER DEFAULT PRIVILEGES\s+IN SCHEMA\s+seller_main\s+GRANT\s+SELECT\s+ON\s+TABLES\s+TO\s+anon/i;
    expect(blanketAnonSelect.test(coreSchema), 'Blanket anon SELECT via default privileges').toBe(false);
  });

  it('no ALTER DEFAULT PRIVILEGES granting full DML to authenticated in seller_main', () => {
    const coreSchema = migration('20250101000000_core_schema.sql');
    const blanketDML = /ALTER DEFAULT PRIVILEGES\s+IN SCHEMA\s+seller_main\s+GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLES\s+TO\s+authenticated/i;
    expect(blanketDML.test(coreSchema), 'Blanket authenticated DML via default privileges').toBe(false);
  });
});

// ============================================================================
// GRANT-C01: Utility functions must be revoked from public roles
// ============================================================================

describe('GRANT-C01: utility functions must be revoked from anon', () => {
  it('clone_schema EXECUTE is revoked', () => {
    const hasRevoke = /REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?clone_schema\b/i.test(ALL_SQL);
    expect(hasRevoke, 'clone_schema: EXECUTE not revoked from public roles').toBe(true);
  });

  it('pg_get_tabledef EXECUTE is revoked', () => {
    const hasRevoke = /REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?pg_get_tabledef\b/i.test(ALL_SQL);
    expect(hasRevoke, 'pg_get_tabledef: EXECUTE not revoked from public roles').toBe(true);
  });

  it('pg_get_coldef EXECUTE is revoked', () => {
    const hasRevoke = /REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?pg_get_coldef\b/i.test(ALL_SQL);
    expect(hasRevoke, 'pg_get_coldef: EXECUTE not revoked from public roles').toBe(true);
  });

  it('get_insert_stmt_ddl EXECUTE is revoked', () => {
    const hasRevoke = /REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?get_insert_stmt_ddl\b/i.test(ALL_SQL);
    expect(hasRevoke, 'get_insert_stmt_ddl: EXECUTE not revoked from public roles').toBe(true);
  });
});

// ============================================================================
// GRANT-D01: Default EXECUTE privileges revoked in seller_main
// ============================================================================

describe('GRANT-D01: function execute privilege controls', () => {
  it('default EXECUTE on new functions revoked from anon/authenticated in seller_main', () => {
    const revokePattern =
      /ALTER\s+DEFAULT\s+PRIVILEGES\s+.*IN\s+SCHEMA\s+seller_main[\s\S]*?REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+(?:anon|authenticated)/i;
    expect(ALL_SQL).toMatch(revokePattern);
  });

  it('REVOKE EXECUTE from anon on payment-critical functions', () => {
    expect(ALL_SQL).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+seller_main\.process_stripe_payment_completion_with_bump/i
    );
  });

  it('REVOKE EXECUTE from anon on admin-only functions', () => {
    expect(ALL_SQL).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+seller_main\.admin_get_product_order_bumps/i
    );
  });
});

// ============================================================================
// SQL-A01: SECURITY DEFINER functions must SET search_path
// ============================================================================

describe('SQL-A01: SECURITY DEFINER functions must SET search_path', () => {

  it('get_insert_stmt_ddl includes SET search_path', () => {
    const sql = migration('20260311000000_pg_clone_schema.sql');
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_insert_stmt_ddl');
    expect(fnStart, 'get_insert_stmt_ddl function not found').toBeGreaterThan(-1);
    const fnHeader = sql.slice(fnStart, fnStart + 500);
    const hasSearchPath = /SET\s+search_path\s*=/.test(fnHeader);
    expect(hasSearchPath, 'get_insert_stmt_ddl: missing SET search_path').toBe(true);
  });

  it('no SECURITY DEFINER function should have pg_temp in search_path', () => {
    const lines = ALL_SQL.split('\n');
    const pgTempSearchPaths: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        /SET\s+search_path/i.test(line) &&
        /pg_temp/i.test(line)
      ) {
        pgTempSearchPaths.push(`Line ${i + 1}: ${line}`);
      }
    }

    expect(
      pgTempSearchPaths,
      `Found pg_temp in search_path:\n${pgTempSearchPaths.join('\n')}`
    ).toHaveLength(0);
  });

  it('all SECURITY DEFINER functions should use empty search_path', () => {
    const funcs = extractSecurityDefinerFunctions(ALL_SQL);
    const nonEmptyPath = funcs.filter(f => f.hasSearchPath && f.searchPath !== '');

    expect(
      nonEmptyPath.map(f => `${f.name} has search_path='${f.searchPath}'`),
      'SECURITY DEFINER functions should SET search_path = \'\''
    ).toHaveLength(0);
  });
});

// ============================================================================
// TS-A01: API routes must require authentication
// ============================================================================

describe('TS-A01: API routes must require authentication', () => {

  const GUS_ROUTE = join(
    __dirname,
    '../../../src/app/api/gus/fetch-company-data/route.ts'
  );
  const source = readFileSync(GUS_ROUTE, 'utf-8');

  it('gus route calls an auth helper before processing', () => {
    const hasAuthCheck = (
      /require(?:Admin|AdminOrSeller)Api(?:WithRequest)?\s*\(/.test(source) ||
      /requireMarketplaceAdmin\s*\(/.test(source) ||
      /\bauthenticate\s*\(/.test(source) ||
      /\.auth\.getUser\s*\(/.test(source)
    );
    expect(hasAuthCheck, 'gus route: no authentication check found').toBe(true);
  });

  it('gus route is NOT classified as public in auth tests', () => {
    const authTestPath = join(__dirname, 'api-route-auth.test.ts');
    const authTestSource = readFileSync(authTestPath, 'utf-8');
    const inPublicRoutes = /PUBLIC_ROUTES\s*=\s*new Set\([^)]*gus\/fetch-company-data/s.test(authTestSource);
    expect(inPublicRoutes, 'gus route: still classified as PUBLIC_ROUTES').toBe(false);
  });
});

// ============================================================================
// TS-B01: No hardcoded fallback credentials
// ============================================================================

describe('TS-B01: no hardcoded fallback credentials', () => {

  const SELLER_CLIENT = join(
    __dirname,
    '../../../src/lib/marketplace/seller-client.ts'
  );
  const sellerClientSource = readFileSync(SELLER_CLIENT, 'utf-8');

  it('createSellerPublicClient does not contain dummy key', () => {
    expect(sellerClientSource, 'seller-client: contains hardcoded fallback key')
      .not.toContain('dummy-anon-key-for-build-time');
  });

  it('createSellerPublicClient throws on missing env var', () => {
    const hasFallback = /supabaseAnonKey\s*\|\|\s*['"`]/.test(sellerClientSource);
    expect(hasFallback, 'seller-client: uses || fallback to hardcoded string').toBe(false);
  });

  it('createPublicClient does not have dummy fallback values', () => {
    const serverSource = src('lib/supabase/server.ts');
    expect(serverSource).not.toContain('dummy-anon-key-for-build-time');
    expect(serverSource).not.toContain("'http://localhost:54321'");
  });
});

// ============================================================================
// TS-C01: Admin routes must use createAdminClient()
// ============================================================================

describe('TS-C01: admin routes must use createAdminClient()', () => {
  const adminRoutes = [
    'app/api/admin/payments/stats/route.ts',
    'app/api/admin/payments/export/route.ts',
    'app/api/admin/payments/refund/route.ts',
    'app/api/admin/coupons/route.ts',
  ];

  for (const route of adminRoutes) {
    it(`${route} does not import raw createClient from @supabase/supabase-js`, () => {
      const filePath = join(SRC_DIR, route);
      if (!existsSync(filePath)) return;
      const source = readFileSync(filePath, 'utf-8');
      const importsRawClient = /import\s+\{[^}]*createClient[^}]*\}\s+from\s+['"]@supabase\/supabase-js['"]/i.test(source);
      expect(importsRawClient, `${route}: imports raw createClient instead of createAdminClient`).toBe(false);
    });
  }

  it('admin/coupons uses createAdminClient, createSchemaAwareAdminClient, or createDataClientFromAuth', () => {
    const source = src('app/api/admin/coupons/route.ts');
    expect(source).toMatch(/createAdminClient|createSchemaAwareAdminClient|createDataClientFromAuth/);
  });
});

// ============================================================================
// TS-D01: Dynamic schema clients must validate schema names
// ============================================================================

describe('TS-D01: schema name validation', () => {
  it('createSellerPublicClient calls isValidSellerSchema', () => {
    const source = src('lib/marketplace/seller-client.ts');
    const fnStart = source.indexOf('function createSellerPublicClient');
    expect(fnStart, 'createSellerPublicClient function not found').toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 500);
    const validates = /isValidSellerSchema/.test(fnBody);
    expect(validates, 'createSellerPublicClient: missing schema name validation').toBe(true);
  });
});

// ============================================================================
// TS-E01: Rate limiting must use unique identifiers per user
// ============================================================================

describe('TS-E01: rate limiting must use unique identifiers', () => {
  it('verify-payment does not use shared rate limit bucket', () => {
    const source = src('app/api/verify-payment/route.ts');
    const usesSharedBucket = /['"]anonymous['"]/.test(source);
    expect(usesSharedBucket, 'verify-payment: shared rate limit bucket for anonymous users').toBe(false);
  });

  // openapi.json route removed — swagger-ui-react and /api/v1/docs page deleted
});

// ============================================================================
// TS-F01: External fetch must block redirects
// ============================================================================

describe('TS-F01: external fetch must block redirects', () => {
  it('webhook-service.ts fetch uses redirect: "error"', () => {
    const source = src('lib/services/webhook-service.ts');
    const hasRedirectError = /redirect:\s*['"]error['"]/i.test(source);
    expect(hasRedirectError, 'webhook-service: fetch without redirect blocking').toBe(true);
  });
});

// ============================================================================
// TS-G01: URL validation must cover all address formats
// ============================================================================

describe('TS-G01: URL validation completeness', () => {
  it('webhook URL validation covers mapped address formats', () => {
    // Validation lives in the shared lib — admin route imports from there
    const source = src('lib/validations/webhook.ts');
    const coversAllFormats = /ffff/i.test(source);
    expect(coversAllFormats, 'webhook URL validation: incomplete address format coverage').toBe(true);
  });
});

// ============================================================================
// TS-H01: POST endpoints must validate Content-Type
// ============================================================================

describe('TS-H01: POST endpoints must check Content-Type', () => {
  const endpoints = [
    'app/api/coupons/verify/route.ts',
    'app/api/coupons/auto-apply/route.ts',
    'app/api/waitlist/signup/route.ts',
  ];

  for (const route of endpoints) {
    it(`${route} checks Content-Type header`, () => {
      const filePath = join(SRC_DIR, route);
      if (!existsSync(filePath)) return;
      const source = readFileSync(filePath, 'utf-8');
      const checksIncomingContentType = /headers\.get\s*\(\s*['"]content-type['"]\s*\)/i.test(source) ||
        /content-type.*application\/json/i.test(source);
      expect(checksIncomingContentType, `${route}: no incoming Content-Type validation`).toBe(true);
    });
  }
});

// ============================================================================
// TS-I01: Input validation in API endpoints
// ============================================================================

describe('TS-I01: input validation in API endpoints', () => {
  it('coupons/verify validates productId as UUID', () => {
    const source = src('app/api/coupons/verify/route.ts');
    expect(source).toMatch(/uuid|UUID|[0-9a-f]{8}/i);
  });

  it('coupons/auto-apply validates productId as UUID', () => {
    const source = src('app/api/coupons/auto-apply/route.ts');
    expect(source).toMatch(/uuid|UUID|[0-9a-f]{8}/i);
  });

  it('coupons/auto-apply validates email format', () => {
    const source = src('app/api/coupons/auto-apply/route.ts');
    expect(source).toMatch(/email.*@|emailRegex|email.*length|isValidEmail/i);
  });

  it('refund-requests validates transaction_id type and UUID format', () => {
    const source = src('app/api/refund-requests/route.ts');
    expect(source).toMatch(/typeof\s+transaction_id/);
    expect(source).toMatch(/uuid|UUID|[0-9a-f]{8}/i);
  });

  it('refund-requests validates reason length', () => {
    const source = src('app/api/refund-requests/route.ts');
    expect(source).toMatch(/reason.*length|reason.*2000|maxLength/i);
  });

  it('waitlist/signup validates productId as UUID', () => {
    const source = src('app/api/waitlist/signup/route.ts');
    expect(source).toMatch(/uuid|UUID|[0-9a-f]{8}/i);
  });

  it('admin refund validates reason against allowed values', () => {
    const source = src('app/api/admin/payments/refund/route.ts');
    expect(source).toMatch(
      /duplicate.*fraudulent.*requested_by_customer|VALID_REFUND_REASONS|allowedReasons/i
    );
  });
});

// ============================================================================
// TS-J01: TypeScript reserved slugs aligned with SQL
// ============================================================================

describe('TS-J01: reserved slugs alignment', () => {
  it('TypeScript RESERVED_SLUGS includes Supabase internal schemas', () => {
    const source = src('lib/marketplace/tenant.ts');
    const supabaseInternals = [
      'storage', 'graphql', 'graphql_public', 'realtime', 'pgsodium',
      'supabase_functions', 'supabase_migrations', 'extensions', 'vault',
    ];
    for (const slug of supabaseInternals) {
      expect(source, `Missing reserved slug: ${slug}`).toContain(`'${slug}'`);
    }
  });

  it('TypeScript RESERVED_SLUGS includes common web names', () => {
    const source = src('lib/marketplace/tenant.ts');
    const commonNames = [
      'www', 'login', 'signup', 'dashboard', 'settings',
      'checkout', 'stripe', 'webhook', 'webhooks',
    ];
    for (const slug of commonNames) {
      expect(source, `Missing reserved slug: ${slug}`).toContain(`'${slug}'`);
    }
  });
});

// ============================================================================
// GRANT-E01: Unused admin table has no authenticated grants
// ============================================================================

describe('GRANT-E01: unused table grant restriction', () => {
  it('revenue_goals has no CRUD grants to authenticated (unused table)', () => {
    const sql = migration('20250103000000_features.sql');
    // After REVOKE ALL, there should be no GRANT ... TO authenticated for revenue_goals
    // or at most GRANT SELECT (read-only) — never INSERT/UPDATE/DELETE
    const afterRevoke = sql.split(/REVOKE ALL ON seller_main\.revenue_goals/i).pop() || '';
    const grantMatch = afterRevoke.match(
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE)[^;]*ON\s+seller_main\.revenue_goals[^;]*TO\s+authenticated/i
    );
    expect(
      grantMatch === null || (grantMatch && !/INSERT|UPDATE|DELETE/i.test(grantMatch[0])),
      'revenue_goals should not grant INSERT/UPDATE/DELETE to authenticated (unused table)'
    ).toBe(true);
  });
});

// ============================================================================
// TS-K01: Rate limiting on public product endpoint
// ============================================================================

describe('TS-K01: public product endpoint rate limiting', () => {
  it('public/products/[slug]/route.ts has rate limiting', () => {
    const source = src('app/api/public/products/[slug]/route.ts');
    expect(source).toMatch(/checkRateLimit|rateLimit/);
  });
});

// ============================================================================
// TS-L01: update-payment-metadata SITE_URL guard
// ============================================================================

describe('TS-L01: payment metadata origin guard', () => {
  it('update-payment-metadata rejects when no allowed origins configured', () => {
    const source = src('app/api/update-payment-metadata/route.ts');
    // Must explicitly check that allowedOrigins is non-empty or SITE_URL is set
    expect(source).toMatch(/allowedOrigins\.length\s*===?\s*0|!.*SITE_URL|SITE_URL.*required|no.*allowed.*origin/i);
  });
});

// ============================================================================
// TS-M01: sellf.js endpoint hardening
// ============================================================================

describe('TS-M01: sellf.js endpoint hardening', () => {
  it('sellf/route.ts has rate limiting', () => {
    const source = src('app/api/sellf/route.ts');
    expect(source).toMatch(/checkRateLimit|rateLimit/);
  });

  it('sellf/route.ts clearCache requires admin auth', () => {
    const source = src('app/api/sellf/route.ts');
    // clearCache must be gated behind auth check or admin verification
    expect(source).toMatch(/clearCache.*admin|clearCache.*auth|admin.*clearCache|requireAdmin.*clearCache/is);
  });

  it('sellf/route.ts uses checkFeature (which uses createAdminClient internally) instead of raw createClient', () => {
    const source = src('app/api/sellf/route.ts');
    // Should NOT import createClient from @supabase/supabase-js
    expect(source).not.toMatch(/from\s+['"]@supabase\/supabase-js['"]/);
    // Should use checkFeature from license/resolve (which internally uses createAdminClient)
    expect(source).toMatch(/checkFeature/);
  });
});

// ============================================================================
// TS-N01: Admin CORS — no wildcard on admin endpoints
// ============================================================================

describe('TS-N01: admin CORS hardening', () => {
  it('admin/products/[id]/route.ts uses origin-aware CORS, not wildcard', () => {
    const source = src('app/api/admin/products/[id]/route.ts');
    // Should have getCorsHeaders or getAdminCorsOrigin pattern
    expect(source).toMatch(/getCorsHeaders|getAdminCorsOrigin/);
    // Should NOT have hardcoded wildcard '*' for CORS origin
    expect(source).not.toMatch(/'Access-Control-Allow-Origin':\s*['"]\*['"]/);
  });
});

// ============================================================================
// TS-O01: Admin export — dateRange NaN guard
// ============================================================================

describe('TS-O01: admin export input validation', () => {
  it('admin/payments/export validates dateRange is a valid number', () => {
    const source = src('app/api/admin/payments/export/route.ts');
    // Must check for NaN or isFinite after parseInt
    expect(source).toMatch(/isNaN|isFinite|Number\.isInteger|Number\.isFinite/);
  });
});

// ============================================================================
// SQL-B01: Free access duration capped to product config
// ============================================================================

describe('SQL-B01: free access duration cap', () => {
  it('grant_free_product_access caps duration to product auto_grant_duration_days', () => {
    const sql = migration('20260306170242_add_rate_limit_to_grant_free_access.sql');
    // When product has auto_grant_duration_days set, user-supplied duration
    // should not exceed it (LEAST or explicit cap)
    expect(sql).toMatch(/LEAST|auto_grant_duration_days.*access_duration_days|cap.*duration|clamp/i);
  });
});
