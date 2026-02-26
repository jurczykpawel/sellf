/**
 * API Integration Tests: Consent Logging
 *
 * Tests the /api/consent POST endpoint against a live dev server.
 * Verifies consent logging toggle, DB insertion, and rate limiting.
 *
 * Run: bun run test:api (requires dev server running at localhost:3000)
 *
 * @see admin-panel/src/app/api/consent/route.ts
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

/** Prefix used for anonymous_id values in tests, for cleanup */
const TEST_ANON_PREFIX = 'consent-test-';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST to /api/consent with JSON body */
async function postConsent(body: Record<string, unknown>) {
  return fetch(`${API_URL}/api/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Generate a valid consent request body */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    anonymous_id: `${TEST_ANON_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
    consents: { 'google-tag-manager': true },
    consent_version: '1',
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

  // Clean up consent_logs entries created during tests
  await supabase
    .from('consent_logs')
    .delete()
    .like('anonymous_id', `${TEST_ANON_PREFIX}%`);

  // Clean up rate limit entries created during tests
  await supabase
    .from('application_rate_limits')
    .delete()
    .eq('action_type', 'consent_log');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/consent', () => {
  // ===== LOGGING DISABLED =====

  describe('Logging disabled', () => {
    it('should return success with "Logging disabled" message when consent_logging_enabled is false', async () => {
      await supabase.from('integrations_config').upsert({
        id: 1,
        consent_logging_enabled: false,
      });

      const res = await postConsent(validBody());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Logging disabled');
    });
  });

  // ===== LOGGING ENABLED — SUCCESSFUL INSERT =====

  describe('Logging enabled', () => {
    beforeAll(async () => {
      await supabase.from('integrations_config').upsert({
        id: 1,
        consent_logging_enabled: true,
      });
    });

    it('should return success and insert a row into consent_logs', async () => {
      const anonId = `${TEST_ANON_PREFIX}insert-${Date.now()}`;
      const res = await postConsent(
        validBody({
          anonymous_id: anonId,
          consents: { 'google-tag-manager': true },
          consent_version: '1',
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toBeUndefined();

      // Verify the row exists in the database via service role
      const { data: row, error } = await supabase
        .from('consent_logs')
        .select('*')
        .eq('anonymous_id', anonId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(row).not.toBeNull();
      expect(row!.anonymous_id).toBe(anonId);
    });

    it('should store all fields correctly including ip_address and user_agent', async () => {
      const anonId = `${TEST_ANON_PREFIX}fields-${Date.now()}`;
      const consents = { 'google-tag-manager': true };
      const consentVersion = '2';

      const res = await postConsent(
        validBody({
          anonymous_id: anonId,
          consents,
          consent_version: consentVersion,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify stored fields
      const { data: row, error } = await supabase
        .from('consent_logs')
        .select('*')
        .eq('anonymous_id', anonId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(row).not.toBeNull();
      expect(row!.consents).toEqual(consents);
      expect(row!.consent_version).toBe(consentVersion);
      // ip_address and user_agent should be populated (non-null)
      expect(row!.ip_address).not.toBeNull();
      expect(row!.user_agent).not.toBeNull();
    });

    it('should store multiple consent choices correctly in JSONB', async () => {
      const anonId = `${TEST_ANON_PREFIX}multi-${Date.now()}`;
      const consents = {
        'google-tag-manager': true,
        'facebook-pixel': false,
        'umami-analytics': true,
      };

      const res = await postConsent(
        validBody({
          anonymous_id: anonId,
          consents,
          consent_version: '1',
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify all consent choices are stored correctly
      const { data: row, error } = await supabase
        .from('consent_logs')
        .select('consents')
        .eq('anonymous_id', anonId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(row).not.toBeNull();
      expect(row!.consents).toEqual(consents);
      expect(row!.consents['google-tag-manager']).toBe(true);
      expect(row!.consents['facebook-pixel']).toBe(false);
      expect(row!.consents['umami-analytics']).toBe(true);
    });
  });

  // ===== RATE LIMITING =====

  describe.skipIf(!process.env.RATE_LIMIT_TEST_MODE)('Rate limiting (requires RATE_LIMIT_TEST_MODE=true)', () => {
    it('should return 429 after exceeding rate limit', async () => {
      // Clean up any existing rate limit entries for consent_log
      await supabase
        .from('application_rate_limits')
        .delete()
        .eq('action_type', 'consent_log');

      // The route allows 30 requests per minute
      const requests = [];
      for (let i = 0; i < 31; i++) {
        requests.push(
          postConsent(
            validBody({ anonymous_id: `${TEST_ANON_PREFIX}ratelimit-${i}-${Date.now()}` })
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
