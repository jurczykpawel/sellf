/**
 * API Integration Tests: Facebook Conversions API (fb-capi)
 *
 * Tests the /api/tracking/fb-capi POST endpoint against a live dev server.
 * Uses fake Facebook credentials so the FB Graph API call fails, but we can
 * still verify consent logic, validation, and rate limiting that happen before it.
 *
 * Run: bun run test:api (requires dev server running at localhost:3000)
 *
 * @see admin-panel/src/app/api/tracking/fb-capi/route.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

const API_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST to /api/tracking/fb-capi with JSON body */
async function postCapi(body: Record<string, unknown>) {
  return fetch(`${API_URL}/api/tracking/fb-capi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
    await supabase.from('integrations_config').upsert(originalConfig);
  } else {
    // If there was no row originally, delete the test row
    await supabase.from('integrations_config').delete().eq('id', 1);
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
    it('should return 400 when fb_capi_enabled is false', async () => {
      // Set up config with CAPI disabled
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: false,
        facebook_pixel_id: 'fake-pixel-123',
        facebook_capi_token: 'fake-token-abc',
      });

      const res = await postCapi(validBody());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/not configured/i);
    });

    it('should return 400 when pixel_id is missing', async () => {
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: null,
        facebook_capi_token: 'fake-token-abc',
      });

      const res = await postCapi(validBody());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/not configured/i);
    });
  });

  // ===== CONSENT LOGIC =====

  describe('Consent logic', () => {
    beforeAll(async () => {
      // Set up config with CAPI enabled and fake credentials
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        send_conversions_without_consent: false,
      });
    });

    it('should skip ViewContent when has_consent=false and send_conversions_without_consent=false', async () => {
      const res = await postCapi(
        validBody({
          event_name: 'ViewContent',
          has_consent: false,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('no_consent');
    });

    it('should skip ViewContent when has_consent=false even if send_conversions_without_consent=true', async () => {
      // ViewContent is NOT in CONSENT_EXEMPT_EVENTS (only Purchase, Lead)
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        send_conversions_without_consent: true,
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
      expect(body.reason).toBe('no_consent');
    });

    it('should forward Purchase to Facebook when has_consent=false and send_conversions_without_consent=true', async () => {
      // Purchase IS in CONSENT_EXEMPT_EVENTS → should pass consent check
      // Will fail at the Facebook API call (fake token) → 500
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        send_conversions_without_consent: true,
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
      expect(body.error).toMatch(/Facebook API/i);
    });

    it('should forward any event to Facebook when has_consent=true', async () => {
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        send_conversions_without_consent: false,
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
      expect(body.error).toMatch(/Facebook API/i);
    });

    it('should default has_consent to true when not provided (backwards compat)', async () => {
      await supabase.from('integrations_config').upsert({
        id: 1,
        fb_capi_enabled: true,
        facebook_pixel_id: 'fake-pixel-id-000',
        facebook_capi_token: 'fake-capi-token-000',
        send_conversions_without_consent: false,
      });

      // No has_consent field → defaults to true → forwards to Facebook
      const res = await postCapi(
        validBody({
          event_name: 'AddToCart',
        })
      );
      const body = await res.json();

      // Should NOT be skipped — default consent is true
      expect(body.skipped).toBeUndefined();
      // Reached Facebook API → fails with invalid token
      expect(res.status).toBe(500);
      expect(body.error).toMatch(/Facebook API/i);
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
