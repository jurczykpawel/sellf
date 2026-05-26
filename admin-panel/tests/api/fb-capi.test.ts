/**
 * API Integration Tests: Facebook Conversions API (fb-capi)
 *
 * Tests the /api/tracking/fb-capi POST endpoint against a live dev server.
 * Uses fake Facebook credentials so the FB Graph API call fails, but we can
 * still verify consent logic, validation, and rate limiting that happen before it.
 *
 * Run: bun run test:api (requires dev server running at localhost:3777)
 *
 * @see admin-panel/src/app/api/tracking/fb-capi/route.ts
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

const API_URL = process.env.TEST_API_URL || 'http://localhost:3777';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST to /api/tracking/fb-capi with JSON body */
async function postCapi(body: Record<string, unknown>, cookies?: Record<string, string>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookies && Object.keys(cookies).length > 0) {
    headers.Cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  return fetch(`${API_URL}/api/tracking/fb-capi`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Build a sellf_consent cookie value with the given marketing decision */
function consentCookie(marketingAccepted: boolean) {
  return encodeURIComponent(
    JSON.stringify({
      categories: ['necessary', 'analytics', 'marketing'],
      services: {
        necessary: [],
        analytics: ['gtm'],
        marketing: marketingAccepted ? ['pixel'] : [],
      },
    })
  );
}

/** Generate a minimal valid CAPI request body */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    event_name: 'ViewContent',
    event_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    event_source_url: 'https://example.com/product',
    currency: 'PLN',
    value: 99.0,
    content_name: 'Test Product',
    ...overrides,
  };
}

// Store original config so we can restore it in afterAll
let originalConfig: Record<string, unknown> | null = null;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Save existing integrations_config row (if any) so we can restore later
  const { data } = await supabase
    .from('integrations_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  originalConfig = data;
});

afterAll(async () => {
  // Restore original config
  if (originalConfig) {
    await supabase.schema('public' as never).from('integrations_config').upsert(originalConfig);
  } else {
    // If there was no row originally, delete the test row
    await supabase.schema('public' as never).from('integrations_config').delete().eq('id', 1);
  }

  // Clean up rate limit entries created during tests
  await supabase
    .from('application_rate_limits')
    .delete()
    .eq('action_type', 'fb_capi');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/tracking/fb-capi', () => {
  // ===== VALIDATION =====

  describe('Validation', () => {
    it('should return 400 when event_name is missing', async () => {
      const res = await postCapi({ event_id: 'test-123' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/Missing required fields/i);
    });

    it('should return 400 when event_id is missing', async () => {
      const res = await postCapi({ event_name: 'Purchase' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/Missing required fields/i);
    });
  });

  // ===== CAPI NOT CONFIGURED =====

  describe('CAPI not configured', () => {
    // Explicitly turn off the sibling GTM SS destination too — a leftover
    // gtm_ss_enabled=true (e.g. from a prior Playwright integrations test on
    // the same DB) would piggyback as an active destination and turn this
    // suite's "no destination" assertions (expected 400) into 500s.
    beforeEach(async () => {
      await supabase
        .schema('public' as never)
        .from('integrations_config')
        .upsert({ id: 1, gtm_ss_enabled: false, gtm_server_container_url: null });
    });

    it('should return 400 when fb_capi_enabled is false', async () => {
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: false,
        facebook_pixel_id: 'fake-pixel-123',
        facebook_capi_token: 'fake-token-abc',
      });

      const res = await postCapi(validBody());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/configured/i);
    });

    it('should return 400 when pixel_id is missing', async () => {
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: null,
        facebook_capi_token: 'fake-token-abc',
      });

      const res = await postCapi(validBody());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/configured/i);
    });
  });

  // ===== CONSENT LOGIC =====

  describe('Consent logic', () => {
    beforeAll(async () => {
      // Set up config with CAPI enabled, fake credentials, strict mode.
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'strict',
      });
    });

    it('should skip ViewContent when has_consent=false and mode=strict', async () => {
      const res = await postCapi(
        validBody({
          event_name: 'ViewContent',
          has_consent: false,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('browsing_event_requires_consent');
    });

    it('should skip ViewContent when has_consent=false even in permissive mode', async () => {
      // Browsing events always require consent; permissive only opens up Purchase/Lead.
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'permissive',
      });

      const res = await postCapi(
        validBody({
          event_name: 'ViewContent',
          has_consent: false,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('browsing_event_requires_consent');
    });

    it('should forward Purchase to Facebook when has_consent=false and mode=permissive', async () => {
      // Purchase is allowed without consent under permissive mode → passes through.
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'permissive',
      });

      const res = await postCapi(
        validBody({
          event_name: 'Purchase',
          has_consent: false,
          value: 49.99,
          currency: 'PLN',
        })
      );
      const body = await res.json();

      // Passed consent check → reached Facebook API → fails with invalid token
      expect(res.status).toBe(500);
      expect(body.error).toMatch(/(failed|destination)/i);
    });

    it('should forward any event to Facebook when has_consent=true', async () => {
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'strict',
      });

      const res = await postCapi(
        validBody({
          event_name: 'ViewContent',
          has_consent: true,
        })
      );
      const body = await res.json();

      // Passed consent check → reached Facebook API → fails with invalid token
      expect(res.status).toBe(500);
      expect(body.error).toMatch(/(failed|destination)/i);
    });

    it('should default has_consent to true when not provided (backwards compat)', async () => {
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'strict',
      });

      // No has_consent field → defaults to true → forwards to Facebook
      const res = await postCapi(
        validBody({
          event_name: 'ViewContent',
        })
      );
      const body = await res.json();

      // Should NOT be skipped — default consent is true
      expect(body.skipped).toBeUndefined();
      // Reached Facebook API → fails with invalid token
      expect(res.status).toBe(500);
      expect(body.error).toMatch(/(failed|destination)/i);
    });
  });

  // ===== EVENT NAME ALLOWLIST =====

  describe('Event name allowlist', () => {
    beforeAll(async () => {
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'permissive',
      });
    });

    it('should reject unknown event_name with 400', async () => {
      const res = await postCapi(validBody({ event_name: 'FakePurchase', has_consent: true }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/event_name/i);
    });

    it.each(['ViewContent', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead'])(
      'should accept canonical event_name %s',
      async (eventName) => {
        const res = await postCapi(validBody({ event_name: eventName, has_consent: true }));
        // Either 500 (forwarded → fake token rejected) or 200 (skipped legitimately)
        expect(res.status).not.toBe(400);
      }
    );
  });

  // ===== SERVER-SIDE CONSENT VERIFICATION =====

  describe('Server-side consent verification (cookie wins over body)', () => {
    beforeAll(async () => {
      await supabase.schema('public' as never).from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        conversion_tracking_mode: 'strict',
      });
    });

    it('skips ViewContent when body says has_consent=true but cookie says rejected', async () => {
      const res = await postCapi(
        validBody({ event_name: 'ViewContent', has_consent: true }),
        { sellf_consent: consentCookie(false) }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('browsing_event_requires_consent');
    });

    it('forwards ViewContent when body says has_consent=false but cookie says accepted', async () => {
      const res = await postCapi(
        validBody({ event_name: 'ViewContent', has_consent: false }),
        { sellf_consent: consentCookie(true) }
      );

      // Cookie says yes → forwarded → fake token rejected by FB (500)
      expect(res.status).toBe(500);
    });

    it('falls back to body has_consent when cookie is absent', async () => {
      const res = await postCapi(validBody({ event_name: 'ViewContent', has_consent: false }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('browsing_event_requires_consent');
    });
  });

  // ===== RATE LIMITING =====

  describe.skipIf(!process.env.RATE_LIMIT_TEST_MODE)('Rate limiting (requires RATE_LIMIT_TEST_MODE=true)', () => {
    it('should return 429 after exceeding rate limit', async () => {
      // Clean up any existing rate limit entries for fb_capi
      await supabase
        .from('application_rate_limits')
        .delete()
        .eq('action_type', 'fb_capi');

      // The route allows 30 requests per minute
      const requests = [];
      for (let i = 0; i < 31; i++) {
        requests.push(
          postCapi(
            validBody({ event_id: `rate-limit-test-${i}-${Date.now()}` })
          )
        );
      }

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      const has429 = statuses.includes(429);
      expect(has429).toBe(true);

      const count429 = statuses.filter((s) => s === 429).length;
      expect(count429).toBeGreaterThanOrEqual(1);
    });
  });
});
