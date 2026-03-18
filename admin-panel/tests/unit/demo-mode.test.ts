/**
 * Demo Mode Unit Tests
 *
 * Tests for:
 * 1. isDemoMode() utility
 * 2. Proxy demo blocking logic (source verification against proxy.ts)
 * 3. Server action guards (throw + return patterns)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// =============================================================================
// Module-level mocks — required for server action imports to resolve
// =============================================================================

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createPublicClient: vi.fn(),
}));

vi.mock('@/lib/services/currency-encryption', () => ({
  encryptCurrencyKey: vi.fn(),
  decryptCurrencyKey: vi.fn(),
}));

vi.mock('@/lib/services/stripe-encryption', () => ({
  encryptStripeKey: vi.fn(),
  decryptStripeKey: vi.fn(),
}));

vi.mock('@/lib/services/gus-encryption', () => ({
  encryptGUSKey: vi.fn(),
  decryptGUSKey: vi.fn(),
}));

vi.mock('@/lib/validations/integrations', () => ({
  validateIntegrations: vi.fn(),
}));

vi.mock('@/lib/license/verify', () => ({
  validateLicense: vi.fn(),
  extractDomainFromUrl: vi.fn(),
}));

vi.mock('@/lib/stripe/payment-method-configs', () => ({
  fetchStripePaymentMethodConfigs: vi.fn(),
  fetchStripePaymentMethodConfig: vi.fn(),
  isValidStripePMCId: vi.fn(),
}));

vi.mock('@/lib/utils/payment-method-helpers', () => ({
  RECOMMENDED_CONFIG: {},
}));

vi.mock('@/lib/validations/profile', () => ({
  validateProfile: vi.fn(),
}));

vi.mock('@/lib/redis/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CacheKeys: { SHOP_CONFIG: 'shop_config' },
  CacheTTL: { LONG: 3600 },
}));

vi.mock('stripe', () => ({ default: vi.fn() }));

// =============================================================================
// 1. isDemoMode() utility
// =============================================================================

describe('isDemoMode()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when DEMO_MODE is not set', async () => {
    delete process.env.DEMO_MODE;
    const { isDemoMode } = await import('@/lib/demo-guard');
    expect(isDemoMode()).toBe(false);
  });

  it('returns false when DEMO_MODE is "false"', async () => {
    process.env.DEMO_MODE = 'false';
    const { isDemoMode } = await import('@/lib/demo-guard');
    expect(isDemoMode()).toBe(false);
  });

  it('returns true when DEMO_MODE is "true"', async () => {
    process.env.DEMO_MODE = 'true';
    const { isDemoMode } = await import('@/lib/demo-guard');
    expect(isDemoMode()).toBe(true);
  });

  it('exports DEMO_MODE_ERROR constant', async () => {
    const { DEMO_MODE_ERROR } = await import('@/lib/demo-guard');
    expect(DEMO_MODE_ERROR).toBe('This action is disabled in demo mode');
  });
});

// =============================================================================
// 2. Proxy demo blocking logic — source verification
// =============================================================================

describe('Proxy demo blocking (whitelist verified against source)', () => {
  const proxySource = readFileSync(
    resolve(__dirname, '../../src/proxy.ts'),
    'utf-8',
  );

  // Extract DEMO_MUTATION_ALLOWED entries from production source
  function extractWhitelistFromSource(source: string): string[] {
    const match = source.match(
      /const DEMO_MUTATION_ALLOWED\s*=\s*\[([\s\S]*?)\]/,
    );
    if (!match) throw new Error('Could not find DEMO_MUTATION_ALLOWED in proxy.ts');
    return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  }

  // Extract isDemoBlocked implementation details from production source
  function extractBlockedLogicChecks(source: string): {
    checksEnv: boolean;
    allowsGetHeadOptions: boolean;
    checksApiPrefix: boolean;
  } {
    const fnMatch = source.match(
      /function isDemoBlocked\([\s\S]*?\{([\s\S]*?)\n\}/,
    );
    if (!fnMatch) throw new Error('Could not find isDemoBlocked in proxy.ts');
    const fnBody = fnMatch[1];
    return {
      checksEnv: fnBody.includes("process.env.DEMO_MODE !== 'true'"),
      allowsGetHeadOptions: /GET.*HEAD.*OPTIONS/.test(fnBody),
      checksApiPrefix: fnBody.includes("pathname.startsWith('/api')"),
    };
  }

  const whitelist = extractWhitelistFromSource(proxySource);
  const logicChecks = extractBlockedLogicChecks(proxySource);

  it('isDemoBlocked checks DEMO_MODE env var', () => {
    expect(logicChecks.checksEnv).toBe(true);
  });

  it('isDemoBlocked allows GET, HEAD, OPTIONS methods', () => {
    expect(logicChecks.allowsGetHeadOptions).toBe(true);
  });

  it('isDemoBlocked only blocks /api routes', () => {
    expect(logicChecks.checksApiPrefix).toBe(true);
  });

  it('whitelist includes checkout flow routes', () => {
    expect(whitelist).toContain('/api/create-payment-intent');
    expect(whitelist).toContain('/api/verify-payment');
    expect(whitelist).toContain('/api/create-embedded-checkout');
    expect(whitelist).toContain('/api/update-payment-metadata');
  });

  it('whitelist includes webhook routes', () => {
    expect(whitelist).toContain('/api/webhooks/');
  });

  it('whitelist includes auth routes', () => {
    expect(whitelist).toContain('/api/auth/');
  });

  it('whitelist includes public and consent routes', () => {
    expect(whitelist).toContain('/api/public/');
    expect(whitelist).toContain('/api/consent');
    expect(whitelist).toContain('/api/tracking/');
    expect(whitelist).toContain('/api/waitlist/');
  });

  it('whitelist includes operational routes', () => {
    expect(whitelist).toContain('/api/validate-email');
    expect(whitelist).toContain('/api/health');
    expect(whitelist).toContain('/api/status');
    expect(whitelist).toContain('/api/runtime-config');
    expect(whitelist).toContain('/api/sellf');
    expect(whitelist).toContain('/api/sellf-embed');
  });

  it('whitelist does NOT include /api/admin (blocked by default)', () => {
    const adminRoutes = whitelist.filter(r => r.startsWith('/api/admin'));
    expect(adminRoutes).toHaveLength(0);
  });

  it('whitelist does NOT include /api/v1 (blocked by default)', () => {
    const v1Routes = whitelist.filter(r => r.startsWith('/api/v1'));
    expect(v1Routes).toHaveLength(0);
  });

  it('unknown endpoints are blocked by default (not in whitelist)', () => {
    expect(whitelist).not.toContain('/api/some-new-endpoint');
    expect(whitelist).not.toContain('/api/dangerous/delete-all');
  });
});

// =============================================================================
// 3. Server action guards
// =============================================================================

describe('Server action demo guards', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, DEMO_MODE: 'true' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // --- Result-pattern actions ---

  describe('categories (result pattern)', () => {
    it('createCategory returns error in demo mode', async () => {
      const { createCategory } = await import('@/lib/actions/categories');
      const result = await createCategory({ name: 'Test', slug: 'test' });
      expect(result).toEqual({ success: false, error: 'This action is disabled in demo mode' });
    });

    it('updateCategory returns error in demo mode', async () => {
      const { updateCategory } = await import('@/lib/actions/categories');
      const result = await updateCategory('123', { name: 'Test', slug: 'test' });
      expect(result).toEqual({ success: false, error: 'This action is disabled in demo mode' });
    });

    it('deleteCategory returns error in demo mode', async () => {
      const { deleteCategory } = await import('@/lib/actions/categories');
      const result = await deleteCategory('123');
      expect(result).toEqual({ success: false, error: 'This action is disabled in demo mode' });
    });

    it('updateProductCategories returns error in demo mode', async () => {
      const { updateProductCategories } = await import('@/lib/actions/categories');
      const result = await updateProductCategories('prod-1', ['cat-1']);
      expect(result).toEqual({ success: false, error: 'This action is disabled in demo mode' });
    });
  });

  describe('preferences', () => {
    it('updateUserPreferences silently succeeds in demo mode', async () => {
      const { updateUserPreferences } = await import('@/lib/actions/preferences');
      const result = await updateUserPreferences({ hideValues: true });
      expect(result).toEqual({ success: true });
    });
  });

  // --- Return-pattern actions ---

  describe('currency-config (return pattern)', () => {
    it('saveCurrencyConfig returns error in demo mode', async () => {
      const { saveCurrencyConfig } = await import('@/lib/actions/currency-config');
      const result = await saveCurrencyConfig({ provider: 'ecb', enabled: true });
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });

    it('deleteCurrencyConfig returns error in demo mode', async () => {
      const { deleteCurrencyConfig } = await import('@/lib/actions/currency-config');
      const result = await deleteCurrencyConfig();
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });
  });

  describe('integrations (return pattern)', () => {
    it('updateIntegrationsConfig returns error in demo mode', async () => {
      const { updateIntegrationsConfig } = await import('@/lib/actions/integrations');
      const result = await updateIntegrationsConfig({} as any);
      expect(result).toMatchObject({ success: false, error: 'This action is disabled in demo mode' });
    });

  });

  describe('stripe-config (return pattern)', () => {
    it('saveStripeConfig returns error in demo mode', async () => {
      const { saveStripeConfig } = await import('@/lib/actions/stripe-config');
      const result = await saveStripeConfig({ apiKey: 'sk_test_xxx', mode: 'test' });
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });

    it('deleteStripeConfig returns error in demo mode', async () => {
      const { deleteStripeConfig } = await import('@/lib/actions/stripe-config');
      const result = await deleteStripeConfig('123');
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });
  });

  describe('gus-config (return pattern)', () => {
    it('saveGUSAPIKey returns error in demo mode', async () => {
      const { saveGUSAPIKey } = await import('@/lib/actions/gus-config');
      const result = await saveGUSAPIKey({ apiKey: 'test-key-12345', enabled: true });
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });

    it('deleteGUSAPIKey returns error in demo mode', async () => {
      const { deleteGUSAPIKey } = await import('@/lib/actions/gus-config');
      const result = await deleteGUSAPIKey();
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });
  });

  describe('payment-config (return pattern)', () => {
    it('updatePaymentMethodConfig returns error in demo mode', async () => {
      const { updatePaymentMethodConfig } = await import('@/lib/actions/payment-config');
      const result = await updatePaymentMethodConfig({ config_mode: 'automatic' } as any);
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });

    it('resetToRecommendedConfig returns error in demo mode', async () => {
      const { resetToRecommendedConfig } = await import('@/lib/actions/payment-config');
      const result = await resetToRecommendedConfig();
      expect(result).toEqual({
        success: false,
        error: 'This action is disabled in demo mode',
        errorCode: 'DEMO_MODE',
      });
    });
  });

  describe('profile (return pattern)', () => {
    it('updateProfile returns error in demo mode', async () => {
      const { updateProfile } = await import('@/lib/actions/profile');
      const result = await updateProfile({} as any);
      expect(result).toEqual({ error: 'This action is disabled in demo mode' });
    });
  });

  describe('shop-config (boolean pattern)', () => {
    it('updateShopConfig returns false in demo mode', async () => {
      const { updateShopConfig } = await import('@/lib/actions/shop-config');
      const result = await updateShopConfig({ shop_name: 'Test' });
      expect(result).toBe(false);
    });
  });
});
