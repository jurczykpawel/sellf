/**
 * Theme License Guard Unit Tests
 *
 * Tests server-side license enforcement on theme mutations:
 * - checkThemeLicense() bypasses in demo mode
 * - saveActiveTheme() / removeActiveTheme() reject without license
 * - Demo mode unlocks all theme operations
 * @see lib/actions/theme.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Module-level mocks
// =============================================================================

const mockCreatePublicClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: mockCreatePublicClient,
}));

// Mock withAdminOrSellerAuth to bypass real auth and call the callback directly
// with a fake dataClient that delegates to the same mock as createPublicClient
vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminOrSellerAuth: vi.fn(async (fn: any) => {
    const fakeDataClient = mockCreatePublicClient();
    return fn({ user: { id: 'test-user' }, supabase: {}, role: 'platform_admin', dataClient: fakeDataClient });
  }),
}));

const mockValidateLicense = vi.fn();
vi.mock('@/lib/license/verify', () => ({
  validateLicense: mockValidateLicense,
  extractDomainFromUrl: (url: string) => {
    try { return new URL(url).hostname; } catch { return null; }
  },
  doesDomainMatch: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
}));

vi.mock('@/lib/license/features', () => ({
  hasFeature: (tier: string, feature: string) => {
    const tiers: Record<string, number> = { free: 0, pro: 1, business: 2 };
    const required: Record<string, string> = { 'theme-customization': 'pro' };
    return (tiers[tier] ?? 0) >= (tiers[required[feature] ?? 'pro'] ?? 1);
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      readFile: mockReadFile,
      unlink: mockUnlink,
    },
  };
});

// =============================================================================
// Test theme data
// =============================================================================

const VALID_THEME = {
  name: 'Test Theme',
  version: '1.0',
  colors: {
    accent: '#FF0000',
    'accent-hover': '#CC0000',
    'accent-soft': 'rgba(255,0,0,0.08)',
    'bg-deep': '#0A0A0A',
    'text-heading': '#FFFFFF',
  },
};

// =============================================================================
// Helpers
// =============================================================================

function createMockClient(license: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { sellf_license: license }, error: null }),
        }),
      }),
    }),
  };
}

function setupSupabaseMock(license: string | null) {
  mockCreatePublicClient.mockReturnValue(createMockClient(license));
}

// =============================================================================
// Tests
// =============================================================================

describe('Theme license guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DEMO_MODE;
    delete process.env.SELLF_LICENSE_KEY;
    // Set platform domain so license domain matching works (resolve.ts rejects when null)
    process.env.SITE_URL = 'https://example.com';
    delete process.env.NEXT_PUBLIC_SITE_URL;
    // Default: validateLicense returns invalid (overridden per-test when needed)
    mockValidateLicense.mockReturnValue({ valid: false, info: { tier: 'free' }, error: 'No license' });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ===========================================================================
  // checkThemeLicense()
  // ===========================================================================

  describe('checkThemeLicense()', () => {
    it('returns true immediately in demo mode without DB call', async () => {
      process.env.DEMO_MODE = 'true';
      const { checkThemeLicense } = await import('@/lib/actions/theme');

      const result = await checkThemeLicense();

      // Now returns ActionResponse<boolean>
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('returns false without license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock(null);

      const { checkThemeLicense } = await import('@/lib/actions/theme');
      const result = await checkThemeLicense();

      expect(result.success).toBe(true);
      expect(result.data).toBe(false);
    });

    it('returns false with invalid license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock('SF-invalid-license');
      mockValidateLicense.mockReturnValue({ valid: false, info: { tier: 'free' }, error: 'Invalid signature' });

      const { checkThemeLicense } = await import('@/lib/actions/theme');
      const result = await checkThemeLicense();

      expect(result.success).toBe(true);
      expect(result.data).toBe(false);
    });

    it('returns true with valid license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock('SF-example.com-UNLIMITED-validSig');
      mockValidateLicense.mockReturnValue({ valid: true, info: { tier: 'pro', domain: 'example.com' } });

      const { checkThemeLicense } = await import('@/lib/actions/theme');
      const result = await checkThemeLicense();

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });
  });

  // ===========================================================================
  // saveActiveTheme() — server-side license enforcement
  // ===========================================================================

  describe('saveActiveTheme()', () => {
    it('rejects without license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock(null);

      const { saveActiveTheme } = await import('@/lib/actions/theme');
      const result = await saveActiveTheme(VALID_THEME as any);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/license/i);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('succeeds in demo mode (license bypassed)', async () => {
      process.env.DEMO_MODE = 'true';

      const { saveActiveTheme } = await import('@/lib/actions/theme');
      const result = await saveActiveTheme(VALID_THEME as any);

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('succeeds with valid license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock('SF-example.com-UNLIMITED-sig');
      mockValidateLicense.mockReturnValue({ valid: true, info: { tier: 'pro', domain: 'example.com' } });

      const { saveActiveTheme } = await import('@/lib/actions/theme');
      const result = await saveActiveTheme(VALID_THEME as any);

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('rejects invalid theme data even with license', async () => {
      process.env.DEMO_MODE = 'true';

      const { saveActiveTheme } = await import('@/lib/actions/theme');
      const result = await saveActiveTheme({ name: '' } as any);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid theme/i);
    });
  });

  // ===========================================================================
  // removeActiveTheme() — server-side license enforcement
  // ===========================================================================

  describe('removeActiveTheme()', () => {
    it('rejects without license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock(null);

      const { removeActiveTheme } = await import('@/lib/actions/theme');
      const result = await removeActiveTheme();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/license/i);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('succeeds in demo mode', async () => {
      process.env.DEMO_MODE = 'true';

      const { removeActiveTheme } = await import('@/lib/actions/theme');
      const result = await removeActiveTheme();

      expect(result.success).toBe(true);
    });

    it('succeeds with valid license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock('SF-example.com-UNLIMITED-sig');
      mockValidateLicense.mockReturnValue({ valid: true, info: { tier: 'pro', domain: 'example.com' } });

      const { removeActiveTheme } = await import('@/lib/actions/theme');
      const result = await removeActiveTheme();

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // applyPreset() — inherits guard from saveActiveTheme()
  // ===========================================================================

  describe('applyPreset()', () => {
    it('rejects without license (non-demo)', async () => {
      process.env.DEMO_MODE = 'false';
      setupSupabaseMock(null);

      const { applyPreset } = await import('@/lib/actions/theme');
      const result = await applyPreset('sunset');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/license/i);
    });

    it('succeeds in demo mode', async () => {
      process.env.DEMO_MODE = 'true';

      const { applyPreset } = await import('@/lib/actions/theme');
      const result = await applyPreset('sunset');

      expect(result.success).toBe(true);
    });

    it('rejects unknown preset', async () => {
      process.env.DEMO_MODE = 'true';

      const { applyPreset } = await import('@/lib/actions/theme');
      const result = await applyPreset('nonexistent-preset');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });
});
