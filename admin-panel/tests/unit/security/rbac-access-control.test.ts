/**
 * ============================================================================
 * SECURITY TEST: Role-Based Access Control — RBAC
 * ============================================================================
 *
 * Verifies that pages and API routes enforce the correct level of access
 * per role: platform_admin, user.
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
// RBAC: Integrations allows seller admins
// ============================================================================

describe('RBAC: Integrations allows seller admins', () => {
  it('integrations page uses verifyAdminAccess, not verifyAdminAccess', () => {
    const source = readSource('app/[locale]/dashboard/integrations/page.tsx');
    expect(
      /verifyAdminAccess/.test(source),
      'Integrations page must use verifyAdminAccess'
    ).toBe(true);
    expect(
      /verifyAdminAccess/.test(source) && !/verifyAdminAccess/.test(source),
      'Integrations page must NOT use verifyAdminAccess (use verifyAdminAccess instead)'
    ).toBe(false);
  });

  it('integrations actions use withAdminClient for schema scoping', () => {
    const source = readSource('lib/actions/integrations.ts');

    // All admin functions should use withAdminClient
    const adminFunctions = [
      'getIntegrationsConfig',
      'updateIntegrationsConfig',
      'getScripts',
      'addScript',
      'deleteScript',
      'toggleScript',
    ];

    // Source must contain withAdminClient
    expect(
      /withAdminClient/.test(source),
      'integrations.ts must use withAdminClient'
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
      `integrations.ts contains bare createClient() calls (should use withAdminClient scoped client):\n` +
      violations.map(l => `  ${l}`).join('\n')
    ).toHaveLength(0);
  });
});

// ============================================================================
// RBAC: Security Audit per role
// ============================================================================

describe('RBAC: Security Audit per role', () => {
  it('security-audit actions use withAdminClient, not withAdminAuth', () => {
    const source = readSource('lib/actions/security-audit.ts');

    expect(
      /withAdminClient/.test(source),
      'security-audit.ts must use withAdminClient'
    ).toBe(true);

    expect(
      /withAdminAuth/.test(source) && !/withAdminClient/.test(source),
      'security-audit.ts must NOT use withAdminAuth (use withAdminClient instead)'
    ).toBe(false);
  });
});

// ============================================================================
// RBAC: Settings actions allow seller admins
// ============================================================================

describe('RBAC: Settings actions allow seller admins', () => {
  it('shop-config uses withAdminClient, not withAdminAuth', () => {
    const source = readSource('lib/actions/shop-config.ts');

    expect(
      /withAdminClient/.test(source),
      'shop-config.ts must use withAdminClient'
    ).toBe(true);

    // Must NOT import withAdminAuth
    expect(
      /import.*withAdminAuth[^O]/.test(source),
      'shop-config.ts must NOT import withAdminAuth (use withAdminClient instead)'
    ).toBe(false);
  });

  it('payment-config uses withAdminClient, not withAdminAuth', () => {
    const source = readSource('lib/actions/payment-config.ts');

    expect(
      /withAdminClient/.test(source),
      'payment-config.ts must use withAdminClient'
    ).toBe(true);

    expect(
      /import.*withAdminAuth[^O]/.test(source),
      'payment-config.ts must NOT import withAdminAuth (use withAdminClient instead)'
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
  it('SettingsTabs requires platform_admin role', () => {
    const source = readSource('components/settings/SettingsTabs.tsx');
    const hasRoleCheck =
      /role\s*===?\s*['"`]platform_admin['"`]/.test(source) ||
      /platform_admin/.test(source) ||
      /isPlatformAdmin/.test(source);

    expect(
      hasRoleCheck,
      'SettingsTabs must check for platform_admin role'
    ).toBe(true);
  });
});
