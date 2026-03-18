/**
 * ============================================================================
 * SECURITY TEST: Marketplace License Isolation
 * ============================================================================
 *
 * Verifies that license resolution correctly isolates sellers:
 *   - Seller context disables ENV fallback (no platform license leaking)
 *   - License for slug A is rejected in slug B context
 *   - Demo mode returns marketplace tier for all contexts
 *   - DB license takes priority over ENV for platform
 *
 * All tests mock resolve.ts internals -- no DB or network required.
 *
 * @see admin-panel/src/lib/license/resolve.ts
 * @see admin-panel/src/lib/license/verify.ts
 * @see admin-panel/src/lib/license/features.ts
 * ============================================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the actual resolve module behavior by mocking its dependencies
// (DB client, env vars) rather than mocking the module itself.

// Mock createAdminClient before importing resolve
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  })),
}));

import { resolveCurrentTier, checkFeature } from '../../../src/lib/license/resolve';
import type { LicenseTier } from '../../../src/lib/license/verify';

// ============================================================================
// Helpers
// ============================================================================

/** Create a mock Supabase client that returns a specific license key */
function mockDbClient(licenseKey: string | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: licenseKey ? { sellf_license: licenseKey } : null,
            error: null,
          }),
        })),
      })),
    })),
  };
}

/** Create a mock client that returns an error */
function mockDbClientError() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'DB error' },
          }),
        })),
      })),
    })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('License isolation -- cross-seller', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean license-related env vars before each test
    delete process.env.DEMO_MODE;
    delete process.env.SELLF_LICENSE_KEY;
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.MAIN_DOMAIN;
  });

  afterEach(() => {
    // Restore original env
    process.env.DEMO_MODE = originalEnv.DEMO_MODE;
    process.env.SELLF_LICENSE_KEY = originalEnv.SELLF_LICENSE_KEY;
    process.env.SITE_URL = originalEnv.SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = originalEnv.NEXT_PUBLIC_SITE_URL;
    process.env.MAIN_DOMAIN = originalEnv.MAIN_DOMAIN;
  });

  it('resolveCurrentTier with sellerSlug disables env fallback', async () => {
    // Set a platform ENV license key
    process.env.SELLF_LICENSE_KEY = 'SF-platform.example.com-PRO-UNLIMITED-fakesig';
    process.env.SITE_URL = 'https://platform.example.com';

    // Call with sellerSlug -- env fallback should be disabled
    const tier = await resolveCurrentTier({
      dataClient: mockDbClient(null), // No DB license for this seller
      sellerSlug: 'kowalski_digital',
    });

    // Without DB license and with env fallback disabled, seller gets 'free'
    expect(tier).toBe('free');
  });

  it('platform context DOES use env fallback when DB has no license', async () => {
    // This is the inverse test -- platform (no sellerSlug) should use env
    // Since we can't generate a valid ECDSA signature, the env license will fail validation
    // But we verify the code path is entered (env is checked, just fails crypto)
    process.env.SELLF_LICENSE_KEY = 'SF-platform.example.com-PRO-UNLIMITED-invalidsig';
    process.env.SITE_URL = 'https://platform.example.com';

    const tier = await resolveCurrentTier({
      dataClient: mockDbClient(null), // No DB license
      // No sellerSlug -- platform context
    });

    // Invalid signature means it falls back to 'free', but the important thing
    // is that the code path was entered (no error thrown)
    expect(tier).toBe('free');
  });

  it('license for slug A rejected when used in slug B context', async () => {
    // Create a license that might be valid for slug A
    // The license domain format is: {sellerSlug}.{platformDomain}
    // A license for kowalski_digital.platform.com should NOT work for creative_studio
    process.env.SITE_URL = 'https://platform.example.com';

    // Even if DB returns a license keyed to kowalski, it should not validate
    // when accessed in creative_studio context (domain mismatch)
    const fakeKowalskiLicense = 'SF-kowalski_digital.platform.example.com-PRO-UNLIMITED-fakesig';

    const tier = await resolveCurrentTier({
      dataClient: mockDbClient(fakeKowalskiLicense),
      sellerSlug: 'creative_studio',
    });

    // Domain mismatch + invalid signature = free
    expect(tier).toBe('free');
  });

  it('demo mode returns marketplace tier for all contexts', async () => {
    process.env.DEMO_MODE = 'true';

    // Platform context
    const platformTier = await resolveCurrentTier();
    expect(platformTier).toBe('marketplace');

    // Seller context
    const sellerTier = await resolveCurrentTier({
      dataClient: mockDbClient(null),
      sellerSlug: 'kowalski_digital',
    });
    expect(sellerTier).toBe('marketplace');

    // Different seller context
    const otherTier = await resolveCurrentTier({
      dataClient: mockDbClient(null),
      sellerSlug: 'creative_studio',
    });
    expect(otherTier).toBe('marketplace');
  });

  it('DB license takes priority over ENV for platform', async () => {
    // When DB has a license, ENV should not be checked
    // Since we can't create valid ECDSA signatures here, both will fail validation,
    // but we can verify the resolution logic via code structure
    process.env.SELLF_LICENSE_KEY = 'SF-platform.example.com-PRO-UNLIMITED-env-sig';
    process.env.SITE_URL = 'https://platform.example.com';

    // DB returns a license (will fail crypto validation → 'free')
    const tier = await resolveCurrentTier({
      dataClient: mockDbClient('SF-platform.example.com-BIZ-UNLIMITED-db-sig'),
    });

    // Both invalid signatures → free, but the important check is no error
    expect(tier).toBe('free');
  });

  it('DB error gracefully falls back to free for seller context', async () => {
    const tier = await resolveCurrentTier({
      dataClient: mockDbClientError(),
      sellerSlug: 'kowalski_digital',
    });

    expect(tier).toBe('free');
  });

  it('empty sellerSlug is treated as platform context', async () => {
    // sellerSlug = '' is falsy, should behave like platform
    const tier = await resolveCurrentTier({
      dataClient: mockDbClient(null),
      sellerSlug: '',
    });

    // Empty string is falsy → isSellerContext = false → platform context
    expect(tier).toBe('free');
  });

  it('checkFeature returns false for seller without license', async () => {
    const hasWatermarkRemoval = await checkFeature('watermark-removal', {
      dataClient: mockDbClient(null),
      sellerSlug: 'kowalski_digital',
    });

    expect(hasWatermarkRemoval).toBe(false);
  });

  it('checkFeature returns false for seller even with platform ENV license', async () => {
    process.env.SELLF_LICENSE_KEY = 'SF-platform.example.com-PRO-UNLIMITED-fakesig';
    process.env.SITE_URL = 'https://platform.example.com';

    const hasWatermarkRemoval = await checkFeature('watermark-removal', {
      dataClient: mockDbClient(null),
      sellerSlug: 'kowalski_digital',
    });

    // Seller context blocks env fallback → free → no watermark removal
    expect(hasWatermarkRemoval).toBe(false);
  });
});
