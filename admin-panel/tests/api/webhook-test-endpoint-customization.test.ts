/**
 * WebhookService.testEndpoint — "Send Test" must honor endpoint customization.
 *
 * Regression: testEndpoint selected only `id, url, secret` and dispatched a plain
 * mock envelope, so a "Send Test" to a customized endpoint (e.g. mailstack) went
 * out WITHOUT the configured Authorization header and WITHOUT the extra fields →
 * the target rejected it. The real trigger() path applies customization via
 * buildEndpointBody + the endpoint's encrypted headers; testEndpoint must match.
 *
 * HTTP layer is mocked exactly like webhook-license-lapse-skip.test.ts /
 * webhook-payload-customization-dispatch.test.ts so dispatch never makes a real
 * network call / hits the SSRF guard. `captured` is reset in beforeEach because
 * the api suite runs every file in ONE process (vitest.config.api.ts:
 * pool:'forks', singleFork:true) and Vitest's retry:1 re-runs the it-block.
 *
 * The seeded endpoint uses an INERT event (`test.event`) so no sibling file's
 * trigger('purchase.completed') can pick it up; testEndpoint is invoked directly
 * with eventType 'purchase.completed' (which selects the nested mock payload).
 *
 * @see src/lib/services/webhook-service.ts (testEndpoint)
 * @see src/lib/webhooks/mock-payloads.ts (WEBHOOK_MOCK_PAYLOADS['purchase.completed'])
 * @see tests/api/webhook-payload-customization-dispatch.test.ts (trigger() counterpart)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';

// ── HTTP layer mocks (must come before the service import) ──────────────────
const captured: { headers?: Record<string, string>; body?: any } = {};
vi.mock('undici', () => ({
  fetch: vi.fn(async (_url: string, init: any) => {
    captured.headers = init.headers;
    captured.body = JSON.parse(init.body);
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

let endpointId: string;

beforeAll(async () => {
  // Required by encryptHeaderMap (used to seed the endpoint's encrypted headers).
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

  const enc = await encryptHeaderMap({ Authorization: 'Bearer TESTKEY' });
  const { data, error } = await admin
    .from('webhook_endpoints')
    .insert({
      url: 'https://example.com/hook-test-endpoint-customization',
      // INERT event: nothing in the suite fires trigger('test.event'), so no
      // sibling file can dispatch this endpoint behind our back.
      events: ['test.event'],
      is_active: true,
      secret: 's',
      product_filter_mode: 'all',
      custom_headers_encrypted: enc,
      custom_payload_fields: { brand: 'tsa', to: '{{email}}' },
      payload_field_selection: ['order'],
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed endpoint: ${error?.message}`);
  endpointId = data.id;
});

beforeEach(() => {
  // singleFork process: clear mock call history and the captured request so a
  // prior attempt (or Vitest retry:1) can't leak into this assertion.
  vi.clearAllMocks();
  captured.headers = undefined;
  captured.body = undefined;
});

afterAll(async () => {
  if (endpointId) {
    await admin.from('webhook_logs').delete().eq('endpoint_id', endpointId);
    await admin.from('webhook_endpoints').delete().eq('id', endpointId);
  }
});

describe('WebhookService.testEndpoint applies endpoint customization', () => {
  it('sends the test with the configured header + extra fields + field selection', async () => {
    await WebhookService.testEndpoint(endpointId, 'purchase.completed');

    const mock = WEBHOOK_MOCK_PAYLOADS['purchase.completed'];

    // Custom header from custom_headers_encrypted must be present.
    expect(captured.headers!['Authorization']).toBe('Bearer TESTKEY');

    // Extra fields: static + placeholder resolved against the NESTED mock.
    expect(captured.body.brand).toBe('tsa');
    expect(captured.body.to).toBe(mock.customer.email);

    // Field selection keeps only `order`; customer/product/etc. dropped.
    expect(Object.keys(captured.body.data)).toEqual(['order']);
    expect(captured.body.data.order).toEqual(mock.order);
  });
});
