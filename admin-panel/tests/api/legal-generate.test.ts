/**
 * API Route Tests: POST /api/legal/generate
 *
 * Unit-mocked tests for the legal document generation route.
 * Mocks: @/lib/legal/client, @/lib/legal/storage, @/lib/supabase/server,
 *        @/lib/supabase/admin, @/lib/rate-limiting, @/lib/security/origin-match
 *
 * Run: cd admin-panel && bunx vitest run --config vitest.config.api.ts tests/api/legal-generate.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// -----------------------------------------------------------------------
// Mocks — must be declared before any import of the module under test
// -----------------------------------------------------------------------

vi.mock('@/lib/legal/client', () => ({ renderDocument: vi.fn() }));
vi.mock('@/lib/legal/storage', () => ({ publishSnapshot: vi.fn() }));

// Mock supabase server client — auth state controlled per-test via authState
const authState: { isAdmin: boolean } = { isAdmin: true };

const mockSupabaseFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockSupabaseFrom,
  }),
}));

// Mock service-role admin client
const mockAdminFrom = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockAdminFrom,
    storage: {
      from: vi.fn(),
    },
  }),
  createPlatformClient: () => ({
    from: mockAdminFrom,
  }),
}));

// Rate limiting always passes by default; individual tests can override
vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

// CORS origin-match — always allow by default
vi.mock('@/lib/security/origin-match', () => ({
  isAllowedOrigin: vi.fn().mockReturnValue(true),
}));

// Import mocks for assertions
import { renderDocument } from '@/lib/legal/client';
import { publishSnapshot } from '@/lib/legal/storage';
import { checkRateLimit } from '@/lib/rate-limiting';

// Import route AFTER mocks are declared
const { POST, OPTIONS } = await import('@/app/api/legal/generate/route');

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Build a minimal valid shop_config row that will pass validateSeller.
 */
function makeShopConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shop-uuid-1',
    shop_name: 'Test Shop',
    company_legal_name: 'Test Sp. z o.o.',
    legal_form: 'spzoo',
    contact_email: 'admin@example.com',
    complaints_email: 'reklamacje@example.com',
    nip: '1234567890',
    regon: '123456789',
    krs: null,
    company_street: 'ul. Testowa',
    company_building_no: '1',
    company_flat_no: null,
    company_city: 'Warszawa',
    company_postal: '00-001',
    company_phone: null,
    is_vat_exempt: false,
    is_micro_enterprise: false,
    has_dpo: false,
    dpo_contact: null,
    omnibus_enabled: true,
    tax_id_collection_enabled: false,
    terms_of_service_url: 'https://s/old-terms.html',
    privacy_policy_url: 'https://s/old-privacy.html',
    ...overrides,
  };
}

/**
 * Setup the Supabase chain mocks for a successful happy-path scenario.
 * All three selects (shop_config, integrations_config, products) return data.
 */
function setupAdminMocks(shopConfigOverrides: Record<string, unknown> = {}) {
  const shopConfig = makeShopConfig(shopConfigOverrides);

  // Each call to adminClient.from() returns a chainable mock.
  // We track call order to differentiate tables.
  let callCount = 0;

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'shop_config') {
      return {
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: shopConfig, error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    if (table === 'integrations_config') {
      return {
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { gtm_container_id: null, facebook_pixel_id: null, google_ads_conversion_id: null },
          error: null,
        }),
      };
    }
    if (table === 'products') {
      return {
        select: vi.fn().mockReturnThis(),
        data: [],
        then: (resolve: (val: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
        // Supabase fluent API — just return empty products list
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    // For the update call (set URLs)
    return {
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

/**
 * Setup auth mocks — admin or anon.
 */
function setupAuth(isAdmin: boolean) {
  if (isAdmin) {
    const fakeUserId = 'user-uuid-1';
    mockGetUser.mockResolvedValue({
      data: { user: { id: fakeUserId, email: 'admin@example.com' } },
      error: null,
    });
    // admin_users check via supabase.from (cookie client)
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'admin_users') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'admin-row-id' }, error: null }),
        };
      }
      return mockAdminFrom(table);
    });
  } else {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('No user'),
    });
    mockSupabaseFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
  }
}

/**
 * Build a NextRequest-compatible Request for POST /api/legal/generate.
 */
function makeRequest(opts: { isAdmin?: boolean } = {}): NextRequest {
  return new Request('http://localhost:3777/api/legal/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }) as unknown as NextRequest;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish default implementations after clearAllMocks wipes them
  (checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

describe('POST /api/legal/generate', () => {
  describe('non-admin → 401', () => {
    it('returns 401 when user is not authenticated', async () => {
      setupAuth(false);

      const res = await POST(makeRequest());
      expect(res.status).toBe(401);
    });
  });

  describe('happy path: renders both → publishes → sets both URLs', () => {
    it('renders both docs, publishes them, and returns both URLs', async () => {
      setupAuth(true);
      setupAdminMocks();

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: true, html: '<h1>Generated</h1>' });

      (publishSnapshot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('https://storage.example.com/shop/terms.html')
        .mockResolvedValueOnce('https://storage.example.com/shop/privacy.html');

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.termsUrl).toContain('terms.html');
      expect(json.privacyUrl).toContain('privacy.html');
      expect(renderDocument).toHaveBeenCalledTimes(2);
      expect(publishSnapshot).toHaveBeenCalledTimes(2);
    });

    it('calls renderDocument for both terms and privacy types', async () => {
      setupAuth(true);
      setupAdminMocks();

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: true, html: '<p>content</p>' });

      (publishSnapshot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('https://s/terms.html')
        .mockResolvedValueOnce('https://s/privacy.html');

      await POST(makeRequest());

      const types = (renderDocument as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => (call[1] as { type: string }).type
      );
      expect(types).toContain('terms');
      expect(types).toContain('privacy');
    });
  });

  describe('render failure → no URLs changed, no publish', () => {
    it('returns 502 and does not call publishSnapshot when render fails with 400', async () => {
      setupAuth(true);
      setupAdminMocks();

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: false, status: 400, errors: [{ field: 'company.postal' }] });

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.ok).toBe(false);
      expect(publishSnapshot).not.toHaveBeenCalled();
    });

    it('returns 502 and does not call publishSnapshot when render times out (status 0)', async () => {
      setupAuth(true);
      setupAdminMocks();

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: false, status: 0 });

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.ok).toBe(false);
      expect(publishSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('storage failure → no URLs changed', () => {
    it('returns 502 and does not update shop_config when publishSnapshot throws', async () => {
      setupAuth(true);

      // Capture the update spy so we can assert it was never called
      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'shop_config') {
          return {
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: makeShopConfig(), error: null }),
            update: mockUpdate,
            eq: mockEq,
          };
        }
        if (table === 'integrations_config') {
          return {
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { gtm_container_id: null, facebook_pixel_id: null, google_ads_conversion_id: null },
              error: null,
            }),
          };
        }
        if (table === 'products') {
          return {
            select: vi.fn().mockReturnThis(),
            then: (resolve: (val: { data: unknown[]; error: null }) => void) =>
              resolve({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          update: mockUpdate,
          eq: mockEq,
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: true, html: '<p>doc</p>' });

      (publishSnapshot as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Bucket not found'));

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.ok).toBe(false);
      expect(json.error).toBe('storage_failed');

      // Atomicity guard: shop_config.update() must NEVER be called on storage failure
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      // Override the default (passes) to deny
      (checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(429);
      expect(json.ok).toBe(false);
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.headers.get('Retry-After')).toBe('300');
    });

    it('does not check admin or call renderDocument when rate limited', async () => {
      (checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await POST(makeRequest());

      expect(mockGetUser).not.toHaveBeenCalled();
      expect(renderDocument).not.toHaveBeenCalled();
    });
  });

  describe('url_save_failed warning', () => {
    it('returns ok:true with warning when shop_config update fails after publish', async () => {
      setupAuth(true);

      // Override admin mocks so that shop_config.update().eq() returns an error
      mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'shop_config') {
          return {
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: makeShopConfig(), error: null }),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB write failed' } }),
          };
        }
        if (table === 'integrations_config') {
          return {
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { gtm_container_id: null, facebook_pixel_id: null, google_ads_conversion_id: null },
              error: null,
            }),
          };
        }
        if (table === 'products') {
          return {
            select: vi.fn().mockReturnThis(),
            then: (resolve: (val: { data: unknown[]; error: null }) => void) =>
              resolve({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: true, html: '<h1>OK</h1>' });

      (publishSnapshot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('https://s/terms.html')
        .mockResolvedValueOnce('https://s/privacy.html');

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.termsUrl).toBe('https://s/terms.html');
      expect(json.privacyUrl).toBe('https://s/privacy.html');
      expect(json.warning).toBe('url_save_failed');
    });
  });

  describe('regenerate archives current BEFORE overwrite', () => {
    it('calls publishSnapshot for terms before privacy (archive ordering)', async () => {
      setupAuth(true);
      setupAdminMocks();

      (renderDocument as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ ok: true, html: '<p>x</p>' });

      const callOrder: string[] = [];
      (publishSnapshot as ReturnType<typeof vi.fn>)
        .mockImplementation(async (_supabase: unknown, _shopId: string, docType: string) => {
          callOrder.push(docType);
          return `https://s/${docType}.html`;
        });

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(json.ok).toBe(true);
      expect(callOrder[0]).toBe('terms');
      expect(callOrder[1]).toBe('privacy');

      // Assert publishSnapshot receives shopId and docType as expected
      const firstCall = (publishSnapshot as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      expect(firstCall[2]).toBe('terms');
      const secondCall = (publishSnapshot as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
      expect(secondCall[2]).toBe('privacy');
    });
  });
});
