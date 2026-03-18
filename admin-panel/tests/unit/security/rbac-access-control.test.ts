/**
 * ============================================================================
 * SECURITY TEST: Role-Based Access Control — RBAC
 * ============================================================================
 *
 * Verifies that pages and API routes enforce the correct level of access
 * per role: platform_admin, seller_admin, user.
 *
 * Uses static source analysis — no live server required.
 *
 * @see api-route-auth.test.ts for the pattern this file follows
 * ============================================================================
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SRC_DIR = join(__dirname, '../../../src');

function readSource(relativePath: string): string {
  return readFileSync(join(SRC_DIR, relativePath), 'utf-8');
}

// ============================================================================
// RBAC: Users API allows seller admins
// ============================================================================

describe('RBAC: Users API allows seller admins', () => {
  const usersRouteFiles = [
    'app/api/v1/users/route.ts',
    'app/api/v1/users/[id]/route.ts',
    'app/api/v1/users/[id]/access/route.ts',
    'app/api/v1/users/[id]/access/[accessId]/route.ts',
  ];

  for (const file of usersRouteFiles) {
    describe(file, () => {
      it('uses authenticate( (not authenticatePlatformAdmin)', () => {
        const source = readSource(file);
        expect(
          /\bauthenticate\s*\(/.test(source),
          `${file} must call authenticate() for seller admin access`
        ).toBe(true);
      });

      it('does NOT use authenticatePlatformAdmin', () => {
        const source = readSource(file);
        expect(
          /authenticatePlatformAdmin\s*\(/.test(source),
          `${file} must NOT call authenticatePlatformAdmin() — seller admins need access`
        ).toBe(false);
      });

      it('does NOT use createAdminClient (should use auth.supabase)', () => {
        const source = readSource(file);
        expect(
          /createAdminClient\s*\(/.test(source),
          `${file} must NOT call createAdminClient() — use auth.supabase instead`
        ).toBe(false);
      });
    });
  }

  it('no users route imports createAdminClient', () => {
    const violations: string[] = [];
    for (const file of usersRouteFiles) {
      const source = readSource(file);
      if (/createAdminClient/.test(source)) {
        violations.push(file);
      }
    }
    expect(
      violations,
      `Users routes importing createAdminClient:\n${violations.map(f => `  ${f}`).join('\n')}\n\n` +
      `Users routes should use auth.supabase (scoped client), not createAdminClient.`
    ).toHaveLength(0);
  });
});

// ============================================================================
// RBAC: Scope presets
// ============================================================================

describe('RBAC: Scope presets', () => {
  it('sellerDefault includes users:read', () => {
    const source = readSource('lib/api/api-keys.ts');
    // Match sellerDefault array containing 'users:read'
    const sellerDefaultMatch = source.match(/sellerDefault\s*[=:]\s*\[([^\]]*)\]/s);
    expect(
      sellerDefaultMatch,
      'api-keys.ts must define a sellerDefault scope preset'
    ).not.toBeNull();
    expect(
      sellerDefaultMatch![1],
      'sellerDefault must include USERS_READ scope'
    ).toContain('USERS_READ');
  });

  it('sellerDefault includes users:write', () => {
    const source = readSource('lib/api/api-keys.ts');
    const sellerDefaultMatch = source.match(/sellerDefault\s*[=:]\s*\[([^\]]*)\]/s);
    expect(
      sellerDefaultMatch,
      'api-keys.ts must define a sellerDefault scope preset'
    ).not.toBeNull();
    expect(
      sellerDefaultMatch![1],
      'sellerDefault must include USERS_WRITE scope'
    ).toContain('USERS_WRITE');
  });
});

// ============================================================================
// RBAC: Integrations allows seller admins
// ============================================================================

describe('RBAC: Integrations allows seller admins', () => {
  it('integrations page uses verifyAdminOrSellerAccess, not verifyAdminAccess', () => {
    const source = readSource('app/[locale]/dashboard/integrations/page.tsx');
    expect(
      /verifyAdminOrSellerAccess/.test(source),
      'Integrations page must use verifyAdminOrSellerAccess'
    ).toBe(true);
    expect(
      /verifyAdminAccess/.test(source) && !/verifyAdminOrSellerAccess/.test(source),
      'Integrations page must NOT use verifyAdminAccess (use verifyAdminOrSellerAccess instead)'
    ).toBe(false);
  });

  it('integrations actions use withAdminOrSellerAuth for schema scoping', () => {
    const source = readSource('lib/actions/integrations.ts');

    // All admin functions should use withAdminOrSellerAuth
    const adminFunctions = [
      'getIntegrationsConfig',
      'updateIntegrationsConfig',
      'getScripts',
      'addScript',
      'deleteScript',
      'toggleScript',
    ];

    // Source must contain withAdminOrSellerAuth
    expect(
      /withAdminOrSellerAuth/.test(source),
      'integrations.ts must use withAdminOrSellerAuth'
    ).toBe(true);

    // Source must NOT contain bare createClient() calls
    // (getPublicIntegrationsConfig using createPublicClient is OK)
    const lines = source.split('\n');
    const violations: string[] = [];
    for (const line of lines) {
      // Match createClient() but not createPublicClient() or createAdminClient()
      if (/\bcreateClient\s*\(/.test(line) && !/createPublicClient|createAdminClient/.test(line)) {
        violations.push(line.trim());
      }
    }
    expect(
      violations,
      `integrations.ts contains bare createClient() calls (should use withAdminOrSellerAuth scoped client):\n` +
      violations.map(l => `  ${l}`).join('\n')
    ).toHaveLength(0);
  });
});

// ============================================================================
// RBAC: Security Audit per role
// ============================================================================

describe('RBAC: Security Audit per role', () => {
  it('security-audit actions use withAdminOrSellerAuth, not withAdminAuth', () => {
    const source = readSource('lib/actions/security-audit.ts');

    expect(
      /withAdminOrSellerAuth/.test(source),
      'security-audit.ts must use withAdminOrSellerAuth'
    ).toBe(true);

    expect(
      /withAdminAuth/.test(source) && !/withAdminOrSellerAuth/.test(source),
      'security-audit.ts must NOT use withAdminAuth (use withAdminOrSellerAuth instead)'
    ).toBe(false);
  });
});

// ============================================================================
// RBAC: Settings actions allow seller admins
// ============================================================================

describe('RBAC: Settings actions allow seller admins', () => {
  it('shop-config uses withAdminOrSellerAuth, not withAdminAuth', () => {
    const source = readSource('lib/actions/shop-config.ts');

    expect(
      /withAdminOrSellerAuth/.test(source),
      'shop-config.ts must use withAdminOrSellerAuth'
    ).toBe(true);

    // Must NOT import withAdminAuth
    expect(
      /import.*withAdminAuth[^O]/.test(source),
      'shop-config.ts must NOT import withAdminAuth (use withAdminOrSellerAuth instead)'
    ).toBe(false);
  });

  it('payment-config uses withAdminOrSellerAuth, not withAdminAuth', () => {
    const source = readSource('lib/actions/payment-config.ts');

    expect(
      /withAdminOrSellerAuth/.test(source),
      'payment-config.ts must use withAdminOrSellerAuth'
    ).toBe(true);

    expect(
      /import.*withAdminAuth[^O]/.test(source),
      'payment-config.ts must NOT import withAdminAuth (use withAdminOrSellerAuth instead)'
    ).toBe(false);
  });

  it('shop-config updateShopConfig uses dataClient, not supabase', () => {
    const source = readSource('lib/actions/shop-config.ts');

    // updateShopConfig should use dataClient for schema-scoped access
    const updateFn = source.match(/async function updateShopConfig[\s\S]*?return result\.success/);
    if (updateFn) {
      expect(
        /dataClient/.test(updateFn[0]),
        'updateShopConfig must use dataClient (schema-scoped) instead of supabase'
      ).toBe(true);
    }
  });
});

// ============================================================================
// RBAC: Platform-only pages remain restricted
// ============================================================================

describe('RBAC: Platform-only pages remain restricted', () => {
  it('admin/sellers page checks platform admin access', () => {
    const source = readSource('app/[locale]/admin/sellers/page.tsx');
    const hasPlatformAdminCheck =
      /admin_users/.test(source) ||
      /verifyAdminAccess/.test(source) ||
      /platform_admin/.test(source) ||
      /isPlatformAdmin/.test(source);

    expect(
      hasPlatformAdminCheck,
      'admin/sellers page must verify platform admin access (admin_users check or verifyAdminAccess)'
    ).toBe(true);
  });

  it('SettingsTabs marketplace tab requires platform_admin role', () => {
    const source = readSource('components/settings/SettingsTabs.tsx');
    const hasRoleCheck =
      /role\s*===?\s*['"`]platform_admin['"`]/.test(source) ||
      /platform_admin/.test(source) ||
      /isPlatformAdmin/.test(source);

    expect(
      hasRoleCheck,
      'SettingsTabs must check for platform_admin role before showing marketplace tab'
    ).toBe(true);
  });
});
