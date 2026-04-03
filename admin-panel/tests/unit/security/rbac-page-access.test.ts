/**
 * ============================================================================
 * SECURITY TEST: RBAC Page Access & Auth Wrapper Verification
 * ============================================================================
 *
 * Comprehensive test that verifies every page, server action, and API route
 * enforces the correct level of access per role:
 *   - platform_admin: full access (dashboard + admin pages)
 *   - user: user-facing pages only (my-products, my-purchases, profile)
 *
 * Uses static source analysis — no live server required.
 *
 * @see rbac-access-control.test.ts — complementary RBAC checks
 * @see api-route-auth.test.ts — API route auth classification
 * ============================================================================
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SRC_DIR = join(__dirname, '../../../src');

function readSource(relativePath: string): string {
  return readFileSync(join(SRC_DIR, relativePath), 'utf-8');
}

// ============================================================================
// 1. Dashboard pages: layout protection
// ============================================================================

describe('Dashboard pages: layout protection', () => {
  it('dashboard/layout.tsx uses verifyAdminAccess', () => {
    const source = readSource('app/[locale]/dashboard/layout.tsx');
    expect(
      /verifyAdminAccess/.test(source),
      'dashboard/layout.tsx must call verifyAdminAccess to protect all child pages'
    ).toBe(true);
  });

  it('dashboard/layout.tsx imports verifyAdminAccess from auth-server', () => {
    const source = readSource('app/[locale]/dashboard/layout.tsx');
    expect(
      /import\s*\{[^}]*verifyAdminAccess[^}]*\}\s*from\s*['"]@\/lib\/auth-server['"]/.test(source),
      'dashboard/layout.tsx must import verifyAdminAccess from @/lib/auth-server'
    ).toBe(true);
  });
});

// ============================================================================
// 2. Platform-admin-only pages
// ============================================================================

describe('Platform-admin-only pages', () => {
  it('admin/payments/page.tsx checks platform admin access', () => {
    const source = readSource('app/[locale]/admin/payments/page.tsx');
    const hasPlatformAdminCheck =
      /admin_users/.test(source) ||
      /verifyAdminAccess/.test(source) ||
      /platform_admin/.test(source) ||
      /isPlatformAdmin/.test(source);

    expect(
      hasPlatformAdminCheck,
      'admin/payments/page.tsx must verify platform admin access'
    ).toBe(true);
  });

  it('admin/payments/page.tsx redirects non-admins', () => {
    const source = readSource('app/[locale]/admin/payments/page.tsx');
    expect(
      /redirect\s*\(/.test(source),
      'admin/payments/page.tsx must redirect unauthorized users'
    ).toBe(true);
  });
});

// ============================================================================
// 3. Server actions: correct auth wrapper per scope
// ============================================================================

describe('Server actions: correct auth wrapper per scope', () => {

  // ----- Platform-admin only actions (must use withAdminAuth) -----

  describe('Platform-admin only actions use withAdminAuth', () => {
    it('gus-config.ts uses withAdminAuth', () => {
      const source = readSource('lib/actions/gus-config.ts');
      expect(
        /withAdminAuth/.test(source),
        'gus-config.ts must use withAdminAuth (platform-admin only configuration)'
      ).toBe(true);
    });

    it('gus-config.ts does NOT use withAdminClient', () => {
      const source = readSource('lib/actions/gus-config.ts');
      expect(
        /withAdminClient/.test(source),
        'gus-config.ts must NOT use withAdminClient (GUS config is platform-admin only)'
      ).toBe(false);
    });

    it('currency-config.ts uses withAdminAuth', () => {
      const source = readSource('lib/actions/currency-config.ts');
      expect(
        /withAdminAuth/.test(source),
        'currency-config.ts must use withAdminAuth (platform-admin only configuration)'
      ).toBe(true);
    });

    it('currency-config.ts does NOT use withAdminClient', () => {
      const source = readSource('lib/actions/currency-config.ts');
      expect(
        /withAdminClient/.test(source),
        'currency-config.ts must NOT use withAdminClient (currency config is platform-admin only)'
      ).toBe(false);
    });
  });

  // ----- Per-shop actions (must use withAdminClient) -----

  describe('Per-shop actions use withAdminClient', () => {
    it('shop-config.ts uses withAdminClient', () => {
      const source = readSource('lib/actions/shop-config.ts');
      expect(
        /withAdminClient/.test(source),
        'shop-config.ts must use withAdminClient'
      ).toBe(true);
    });

    it('shop-config.ts does NOT import withAdminAuth (non-Or variant)', () => {
      const source = readSource('lib/actions/shop-config.ts');
      expect(
        /import.*withAdminAuth[^O]/.test(source),
        'shop-config.ts must NOT import withAdminAuth (use withAdminClient instead)'
      ).toBe(false);
    });

    it('payment-config.ts uses withAdminClient for mutations', () => {
      const source = readSource('lib/actions/payment-config.ts');
      expect(
        /withAdminClient/.test(source),
        'payment-config.ts must use withAdminClient'
      ).toBe(true);
    });

    it('payment-config.ts does NOT import withAdminAuth (non-Or variant)', () => {
      const source = readSource('lib/actions/payment-config.ts');
      expect(
        /import.*withAdminAuth[^O]/.test(source),
        'payment-config.ts must NOT import withAdminAuth (use withAdminClient instead)'
      ).toBe(false);
    });

    it('integrations.ts uses withAdminClient', () => {
      const source = readSource('lib/actions/integrations.ts');
      expect(
        /withAdminClient/.test(source),
        'integrations.ts must use withAdminClient'
      ).toBe(true);
    });

    it('integrations.ts does NOT import withAdminAuth (non-Or variant)', () => {
      const source = readSource('lib/actions/integrations.ts');
      expect(
        /import.*withAdminAuth[^O]/.test(source),
        'integrations.ts must NOT import withAdminAuth (use withAdminClient instead)'
      ).toBe(false);
    });

    it('security-audit.ts uses withAdminClient', () => {
      const source = readSource('lib/actions/security-audit.ts');
      expect(
        /withAdminClient/.test(source),
        'security-audit.ts must use withAdminClient'
      ).toBe(true);
    });

    it('categories.ts uses withAdminClient', () => {
      const source = readSource('lib/actions/categories.ts');
      expect(
        /withAdminClient/.test(source),
        'categories.ts must use withAdminClient'
      ).toBe(true);
    });

    it('categories.ts does NOT import withAdminAuth (non-Or variant)', () => {
      const source = readSource('lib/actions/categories.ts');
      expect(
        /import.*withAdminAuth[^O]/.test(source),
        'categories.ts must NOT import withAdminAuth (use withAdminClient instead)'
      ).toBe(false);
    });

    it('theme.ts uses withAdminClient', () => {
      const source = readSource('lib/actions/theme.ts');
      expect(
        /withAdminClient/.test(source),
        'theme.ts must use withAdminClient'
      ).toBe(true);
    });

    it('theme.ts does NOT import withAdminAuth (non-Or variant)', () => {
      const source = readSource('lib/actions/theme.ts');
      expect(
        /import.*withAdminAuth[^O]/.test(source),
        'theme.ts must NOT import withAdminAuth (use withAdminClient instead)'
      ).toBe(false);
    });

    it('stripe-config.ts uses withAdminAuth for platform Stripe keys (sellers use Connect)', () => {
      const source = readSource('lib/actions/stripe-config.ts');
      expect(
        /withAdminAuth/.test(source),
        'stripe-config.ts must use withAdminAuth — sellers cannot manage platform Stripe keys'
      ).toBe(true);
      // Must NOT use withAdminClient (security: seller could overwrite platform keys)
      expect(
        /withAdminClient/.test(source),
        'stripe-config.ts must NOT use withAdminClient'
      ).toBe(false);
    });

    it('payment.ts uses withAdminClient', () => {
      const source = readSource('lib/actions/payment.ts');
      expect(
        /withAdminClient/.test(source),
        'payment.ts must use withAdminClient'
      ).toBe(true);
    });

    it('dashboard.ts uses withAdminClient for getRecentActivity', () => {
      const source = readSource('lib/actions/dashboard.ts');
      expect(
        /withAdminClient/.test(source),
        'dashboard.ts must use withAdminClient'
      ).toBe(true);
    });
  });
});

// ============================================================================
// 5. API routes: correct auth function per endpoint
// ============================================================================

describe('API routes: correct auth function per endpoint', () => {
  /**
   * V1 routes must use authenticate() (not authenticatePlatformAdmin)
   * to allow both platform admins and seller admins via API keys.
   */
  const V1_ROUTE_FILES = [
    // Products
    'app/api/v1/products/route.ts',
    'app/api/v1/products/[id]/route.ts',
    'app/api/v1/products/[id]/oto/route.ts',
    // Users
    'app/api/v1/users/route.ts',
    'app/api/v1/users/[id]/route.ts',
    'app/api/v1/users/[id]/access/route.ts',
    'app/api/v1/users/[id]/access/[accessId]/route.ts',
    // Coupons
    'app/api/v1/coupons/route.ts',
    'app/api/v1/coupons/[id]/route.ts',
    'app/api/v1/coupons/[id]/stats/route.ts',
    // Payments
    'app/api/v1/payments/route.ts',
    'app/api/v1/payments/[id]/route.ts',
    'app/api/v1/payments/[id]/refund/route.ts',
    'app/api/v1/payments/export/route.ts',
    'app/api/v1/payments/stats/route.ts',
    // Order bumps
    'app/api/v1/order-bumps/route.ts',
    'app/api/v1/order-bumps/[id]/route.ts',
    // Webhooks
    'app/api/v1/webhooks/route.ts',
    'app/api/v1/webhooks/[id]/route.ts',
    'app/api/v1/webhooks/[id]/test/route.ts',
    'app/api/v1/webhooks/logs/route.ts',
    'app/api/v1/webhooks/logs/[logId]/retry/route.ts',
    'app/api/v1/webhooks/logs/[logId]/archive/route.ts',
    // Refund requests
    'app/api/v1/refund-requests/route.ts',
    'app/api/v1/refund-requests/[id]/route.ts',
    // Analytics
    'app/api/v1/analytics/dashboard/route.ts',
    'app/api/v1/analytics/revenue/route.ts',
    'app/api/v1/analytics/top-products/route.ts',
    // API keys
    'app/api/v1/api-keys/route.ts',
    'app/api/v1/api-keys/[id]/route.ts',
    'app/api/v1/api-keys/[id]/rotate/route.ts',
    // Variant groups
    'app/api/v1/variant-groups/route.ts',
    'app/api/v1/variant-groups/[id]/route.ts',
    // System
    'app/api/v1/system/status/route.ts',
    'app/api/v1/system/update-check/route.ts',
    'app/api/v1/system/upgrade-status/route.ts',
    'app/api/v1/system/upgrade/route.ts',
  ];

  for (const file of V1_ROUTE_FILES) {
    const filePath = join(SRC_DIR, file);
    if (!existsSync(filePath)) continue;

    describe(file, () => {
      it('uses authenticate( or requireAdminApi( (not authenticatePlatformAdmin)', () => {
        const source = readSource(file);
        // Must use authenticate() or requireAdminApi() — seller-aware auth functions
        const hasSellerAwareAuth =
          /\bauthenticate\s*\(/.test(source) ||
          /requireAdminApi\s*\(/.test(source);
        expect(
          hasSellerAwareAuth,
          `${file} must call authenticate() or requireAdminApi() for admin/seller access`
        ).toBe(true);
      });

      it('does NOT use authenticatePlatformAdmin', () => {
        const source = readSource(file);
        expect(
          /authenticatePlatformAdmin\s*\(/.test(source),
          `${file} must NOT call authenticatePlatformAdmin() — seller admins need API access too`
        ).toBe(false);
      });
    });
  }

  it('no V1 route uses authenticatePlatformAdmin (summary check)', () => {
    const violations: string[] = [];
    for (const file of V1_ROUTE_FILES) {
      const filePath = join(SRC_DIR, file);
      if (!existsSync(filePath)) continue;
      const source = readSource(file);
      if (/authenticatePlatformAdmin\s*\(/.test(source)) {
        violations.push(file);
      }
    }
    expect(
      violations,
      `V1 API routes using authenticatePlatformAdmin (should use authenticate):\n${violations.map(f => `  ${f}`).join('\n')}`
    ).toHaveLength(0);
  });
});

// ============================================================================
// 6. User pages: accessible to all authenticated users
// ============================================================================

describe('User pages: accessible to all authenticated users', () => {
  const USER_PAGES = [
    { path: 'app/[locale]/my-products/page.tsx', name: 'my-products' },
    { path: 'app/[locale]/my-purchases/page.tsx', name: 'my-purchases' },
    { path: 'app/[locale]/profile/page.tsx', name: 'profile' },
  ];

  for (const page of USER_PAGES) {
    it(`${page.name} page does NOT require admin auth (verifyAdminAccess)`, () => {
      const source = readSource(page.path);
      expect(
        /verifyAdminAccess/.test(source),
        `${page.name} page must NOT call verifyAdminAccess — it's for regular users, not admins`
      ).toBe(false);
    });

    it(`${page.name} page does NOT require admin/seller auth (verifyAdminAccess)`, () => {
      const source = readSource(page.path);
      expect(
        /verifyAdminAccess/.test(source),
        `${page.name} page must NOT call verifyAdminAccess — it's for regular users`
      ).toBe(false);
    });

    it(`${page.name} page does NOT import from admin-auth`, () => {
      const source = readSource(page.path);
      expect(
        /from\s*['"]@\/lib\/actions\/admin-auth['"]/.test(source),
        `${page.name} page must NOT import from admin-auth — it's for regular users`
      ).toBe(false);
    });
  }
});

// ============================================================================
// 7. All server action files have auth wrappers
// ============================================================================

describe('All server action files have auth wrappers', () => {

  /**
   * Functions that are intentionally public or use session-based auth only
   * (no admin wrapper needed). Each entry documents WHY it's public.
   */
  const PUBLIC_OR_SESSION_ONLY_FILES = new Set([
    // Public checkout flow — no auth required (user may be guest)
    'checkout.ts',
    // Email validation — public utility
    'validate-email.ts',
    // Currency conversion — reads exchange rates, no sensitive data
    'currency.ts',
    // Product list — reads via session-scoped client (RLS enforced)
    'products.ts',
    // User profile — session-based auth (getUser), not admin
    'profile.ts',
    // User preferences — session-based auth (getUser), not admin
    'preferences.ts',
    // Analytics — uses withAdminClient with schema-scoped dataClient
    // Stripe tax status — read-only Stripe API check, no mutations
    'stripe-tax.ts',
    // Admin auth module itself — defines the wrappers, doesn't need to wrap itself
    'admin-auth.ts',
  ]);

  /**
   * Files that use requireAdminApi instead of withAdminAuth/withAdminClient.
   * This is an older pattern but still valid for auth enforcement.
   */
  const USES_REQUIRE_ADMIN_API = new Set([
    'stripe-config.ts', // Mix of requireAdminApi and withAdminAuth (platform-only)
  ]);

  it('every action file either uses auth wrappers or is explicitly whitelisted', () => {
    const actionsDir = join(SRC_DIR, 'lib/actions');
    const files = readdirSync(actionsDir).filter(f => f.endsWith('.ts'));
    const violations: string[] = [];

    for (const file of files) {
      if (PUBLIC_OR_SESSION_ONLY_FILES.has(file)) continue;
      if (USES_REQUIRE_ADMIN_API.has(file)) continue;

      const source = readFileSync(join(actionsDir, file), 'utf-8');

      const hasAuthWrapper =
        /withAdminAuth\s*\(/.test(source) ||
        /withAdminClient\s*\(/.test(source) ||
        /requireAdminApi\s*\(/.test(source);

      if (!hasAuthWrapper) {
        violations.push(file);
      }
    }

    expect(
      violations,
      `Action files without auth wrappers (not whitelisted):\n${violations.map(f => `  ${f}`).join('\n')}\n\n` +
      `Either add withAdminAuth/withAdminClient, or whitelist in PUBLIC_OR_SESSION_ONLY_FILES with justification.`
    ).toHaveLength(0);
  });

  it('whitelisted public/session-only files do NOT accidentally use admin wrappers', () => {
    const actionsDir = join(SRC_DIR, 'lib/actions');
    const violations: string[] = [];

    for (const file of PUBLIC_OR_SESSION_ONLY_FILES) {
      if (file === 'admin-auth.ts') continue; // admin-auth defines the wrappers
      const filePath = join(actionsDir, file);
      if (!existsSync(filePath)) continue;

      const source = readFileSync(filePath, 'utf-8');

      // If a "public" file actually uses admin wrappers, it should be moved
      // out of the whitelist to get proper classification
      const hasAdminWrapper =
        /withAdminAuth\s*\(/.test(source) ||
        /withAdminClient\s*\(/.test(source);

      if (hasAdminWrapper) {
        violations.push(`${file} (listed as public but uses admin auth wrapper)`);
      }
    }

    expect(
      violations,
      `Files incorrectly whitelisted as public/session-only:\n${violations.map(f => `  ${f}`).join('\n')}\n\n` +
      `Remove from PUBLIC_OR_SESSION_ONLY_FILES — these files have proper auth wrappers.`
    ).toHaveLength(0);
  });

  it('no new action files added without updating this test', () => {
    const actionsDir = join(SRC_DIR, 'lib/actions');
    const files = readdirSync(actionsDir).filter(f => f.endsWith('.ts'));

    const KNOWN_FILES = new Set([
      'admin-auth.ts',
      'analytics.ts',
      'categories.ts',
      'checkout.ts',
      'currency-config.ts',
      'currency.ts',
      'dashboard.ts',
      'gus-config.ts',
      'integrations.ts',
      'payment-config.ts',
      'payment.ts',
      'preferences.ts',
      'products.ts',
      'profile.ts',
      'security-audit.ts',
      'shop-config.ts',
      'stripe-config.ts',
      'stripe-tax.ts',
      'theme.ts',
      'validate-email.ts',
    ]);

    const unknown = files.filter(f => !KNOWN_FILES.has(f));
    expect(
      unknown,
      `New action files not classified in rbac-page-access.test.ts:\n${unknown.map(f => `  ${f}`).join('\n')}\n\n` +
      `Add each new file to:\n` +
      `  - PUBLIC_OR_SESSION_ONLY_FILES (if intentionally public)\n` +
      `  - USES_REQUIRE_ADMIN_API (if using older requireAdminApi pattern)\n` +
      `  - KNOWN_FILES (always)\n` +
      `And add specific auth wrapper tests if needed.`
    ).toHaveLength(0);
  });
});

// ============================================================================
// 8. Cross-cutting: no privilege escalation vectors
// ============================================================================

describe('Cross-cutting: no privilege escalation vectors', () => {
  it('no action file imports createAdminClient without auth wrapper', () => {
    const actionsDir = join(SRC_DIR, 'lib/actions');
    const files = readdirSync(actionsDir).filter(f => f.endsWith('.ts'));
    const violations: string[] = [];

    for (const file of files) {
      if (file === 'admin-auth.ts') continue; // admin-auth legitimately uses createAdminClient
      const source = readFileSync(join(actionsDir, file), 'utf-8');

      const importsAdminClient = /createAdminClient/.test(source);
      const hasAuthWrapper =
        /withAdminAuth\s*\(/.test(source) ||
        /withAdminClient\s*\(/.test(source) ||
        /requireAdminApi\s*\(/.test(source);

      if (importsAdminClient && !hasAuthWrapper) {
        violations.push(file);
      }
    }

    expect(
      violations,
      `Action files using createAdminClient without auth wrappers:\n${violations.map(f => `  ${f}`).join('\n')}\n\n` +
      `createAdminClient provides service_role access. Every file using it must verify auth first.`
    ).toHaveLength(0);
  });

  it('no action file imports createPlatformClient without withAdminAuth', () => {
    const actionsDir = join(SRC_DIR, 'lib/actions');
    const files = readdirSync(actionsDir).filter(f => f.endsWith('.ts'));
    const violations: string[] = [];

    for (const file of files) {
      if (file === 'admin-auth.ts') continue;
      const source = readFileSync(join(actionsDir, file), 'utf-8');

      const importsPlatformClient = /createPlatformClient/.test(source);
      const hasAdminAuth = /withAdminAuth\s*\(/.test(source);

      if (importsPlatformClient && !hasAdminAuth) {
        violations.push(file);
      }
    }

    expect(
      violations,
      `Action files using createPlatformClient without withAdminAuth:\n${violations.map(f => `  ${f}`).join('\n')}\n\n` +
      `createPlatformClient accesses the platform schema. Only platform admins should use it.`
    ).toHaveLength(0);
  });

  it('SettingsTabs reads role from auth context (not hardcoded)', () => {
    const source = readSource('components/settings/SettingsTabs.tsx');
    expect(
      /useAuth/.test(source),
      'SettingsTabs must read role from useAuth() context, not hardcoded values'
    ).toBe(true);
  });
});
