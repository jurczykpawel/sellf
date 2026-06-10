/**
 * WebhookService.trigger — license-lapse skip regression test.
 *
 * Proves that when the license is inactive (free tier), trigger() silently
 * skips customized endpoints (returns before recordFirstAttempt) while still
 * dispatching plain (non-customized) endpoints normally.
 *
 * Free tier is forced deterministically:
 *   - delete process.env.DEMO_MODE (DEMO_MODE='true' → tier 'business')
 *   - delete process.env.SELLF_LICENSE_KEY (env fallback → 'free')
 *   - ensure integrations_config.sellf_license is null (DB source → 'free')
 *   The three env + DB sources are all 'free', so checkFeature returns false
 *   regardless of .env.local content.
 *
 * HTTP layer is mocked the same way as dispatcher-custom-headers.test.ts and
 * webhook-payload-customization-dispatch.test.ts so the plain endpoint's
 * dispatch does not make real network calls or hit the SSRF guard.
 *
 * @see src/lib/services/webhook-service.ts (trigger → isCustomized + licenseOk guard)
 * @see tests/api/webhook-payload-customization-dispatch.test.ts (DEMO_MODE + undici mock)
 * @see tests/api/webhook-customization-api.test.ts (free-tier 403 pattern)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// ── HTTP layer mocks (must come before the service import) ──────────────────
// Intercept undici.fetch so the plain endpoint's dispatch never makes a real
// network call / hits the SSRF guard. Same pattern as
// dispatcher-custom-headers.test.ts and webhook-payload-customization-dispatch.test.ts.
vi.mock('undici', () => ({
  fetch: vi.fn(async (_url: string, _init: any) => {
    return { ok: true, status: 200, text: async () => 'ok' };
  }),
}));
vi.mock('@/lib/security/safe-fetch', () => ({ getSsrfSafeAgent: vi.fn(() => undefined) }));
vi.mock('@/lib/validations/webhook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/validations/webhook')>()),
  validateWebhookUrlAsync: vi.fn(async () => ({ valid: true })),
}));

// Import service AFTER mocks so the dispatcher binds to the mocked undici.
const { WebhookService } = await import('@/lib/services/webhook-service');

const admin = createClient(
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let customizedEndpointId: string;
let plainEndpointId: string;

// Saved env values restored after the test to avoid leaking state.
let savedDemoMode: string | undefined;
let savedLicenseKey: string | undefined;
let savedSellfLicense: string | null = null;

beforeAll(async () => {
  // ── Force free tier ─────────────────────────────────────────────────────
  // Three sources must ALL resolve to 'free' at the moment trigger() calls
  // checkFeature():
  //   1. DEMO_MODE absent → not business
  //   2. SELLF_LICENSE_KEY absent → no env license
  //   3. integrations_config.sellf_license = null → no DB license
  //
  // The two env sources are (re)cleared in beforeEach — not just here — because
  // the api suite runs every file in ONE process (vitest.config.api.ts:
  // pool:'forks', singleFork:true). A sibling file (e.g.
  // webhook-payload-customization-dispatch.test.ts) sets DEMO_MODE='true' in its
  // own beforeAll; combined with Vitest's `retry:1` re-running this it-block, a
  // leaked DEMO_MODE='true' would otherwise resolve tier to 'business' and the
  // customized endpoint would be dispatched (1 log row) instead of skipped. Save
  // the originals here so afterAll can restore them.
  savedDemoMode = process.env.DEMO_MODE;
  savedLicenseKey = process.env.SELLF_LICENSE_KEY;

  // Save and clear the DB license so any installed license key doesn't bleed in.
  const { data: cfgRow } = await admin
    .from('integrations_config')
    .select('sellf_license')
    .eq('id', 1)
    .maybeSingle();
  savedSellfLicense = (cfgRow as { sellf_license: string | null } | null)?.sellf_license ?? null;
  if (savedSellfLicense !== null) {
    await admin.from('integrations_config').update({ sellf_license: null }).eq('id', 1);
  }

  // APP_ENCRYPTION_KEY is required by encryptHeaderMap (used when persisting
  // the endpoint). Set it to a known value even though encryption is not the
  // focus of this test.
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

  // ── Seed two endpoints on the same event ────────────────────────────────
  // Customized: has custom_payload_fields → isCustomized() returns true.
  const { data: customRow, error: customErr } = await admin
    .from('webhook_endpoints')
    .insert({
      url: 'https://example.com/hook-license-lapse-custom',
      events: ['purchase.completed'],
      is_active: true,
      secret: 's',
      product_filter_mode: 'all',
      custom_payload_fields: { brand: 'tsa' },
    })
    .select('id')
    .single();
  if (customErr || !customRow) throw new Error(`seed customized endpoint: ${customErr?.message}`);
  customizedEndpointId = customRow.id;

  // Plain: no custom_headers_encrypted / custom_payload_fields / payload_field_selection
  // → isCustomized() returns false → dispatched even on free tier.
  const { data: plainRow, error: plainErr } = await admin
    .from('webhook_endpoints')
    .insert({
      url: 'https://example.com/hook-license-lapse-plain',
      events: ['purchase.completed'],
      is_active: true,
      secret: 's',
      product_filter_mode: 'all',
    })
    .select('id')
    .single();
  if (plainErr || !plainRow) throw new Error(`seed plain endpoint: ${plainErr?.message}`);
  plainEndpointId = plainRow.id;
});

beforeEach(() => {
  // Re-assert free tier immediately before every it-block attempt (including
  // Vitest's `retry:1`). In the shared singleFork process a sibling file may
  // have set DEMO_MODE='true' / a license env after our beforeAll ran; clearing
  // here guarantees the tier resolves to 'free' at trigger() time so the
  // customized endpoint is genuinely skipped, not dispatched.
  delete process.env.DEMO_MODE;
  delete process.env.SELLF_LICENSE_KEY;
  // Drop any log rows a prior attempt of this it-block (or a leaked sibling
  // dispatch) wrote for OUR seeded endpoints, so the per-attempt row counts are
  // exact rather than cumulative.
  // (No await needed in beforeEach return — vitest awaits the returned promise.)
  return cleanupSeededLogs();
});

async function cleanupSeededLogs(): Promise<void> {
  const endpointIds = [customizedEndpointId, plainEndpointId].filter(Boolean);
  if (endpointIds.length > 0) {
    await admin.from('webhook_logs').delete().in('endpoint_id', endpointIds);
  }
}

afterAll(async () => {
  // ── Restore env ─────────────────────────────────────────────────────────
  if (savedDemoMode !== undefined) process.env.DEMO_MODE = savedDemoMode;
  else delete process.env.DEMO_MODE;

  if (savedLicenseKey !== undefined) process.env.SELLF_LICENSE_KEY = savedLicenseKey;
  else delete process.env.SELLF_LICENSE_KEY;

  // Restore DB license if we cleared it.
  if (savedSellfLicense !== null) {
    await admin.from('integrations_config').update({ sellf_license: savedSellfLicense }).eq('id', 1);
  }

  // ── Clean up seeded rows ─────────────────────────────────────────────────
  const endpointIds = [customizedEndpointId, plainEndpointId].filter(Boolean);
  if (endpointIds.length > 0) {
    await admin.from('webhook_logs').delete().in('endpoint_id', endpointIds);
    await admin.from('webhook_endpoints').delete().in('id', endpointIds);
  }
});

describe('WebhookService.trigger — license-lapse skip', () => {
  it('skips customized endpoint but dispatches plain endpoint when license inactive', async () => {
    await WebhookService.trigger(
      'purchase.completed',
      { customer: { email: 'a@b.com' }, order: { amount: 1000 } },
      admin,
    );

    // Allow a brief moment for Promise.allSettled to settle DB writes.
    // (trigger() awaits them internally, so none needed — but query right away.)

    const { data: customLogs } = await admin
      .from('webhook_logs')
      .select('id')
      .eq('endpoint_id', customizedEndpointId);

    const { data: plainLogs } = await admin
      .from('webhook_logs')
      .select('id')
      .eq('endpoint_id', plainEndpointId);

    // Customized endpoint: skipped → 0 log rows.
    expect(
      customLogs?.length ?? 0,
      'customized endpoint must produce 0 log rows when license inactive',
    ).toBe(0);

    // Plain endpoint: dispatched normally → ≥1 log row.
    expect(
      plainLogs?.length ?? 0,
      'plain endpoint must produce ≥1 log row regardless of license tier',
    ).toBeGreaterThanOrEqual(1);
  });
});
