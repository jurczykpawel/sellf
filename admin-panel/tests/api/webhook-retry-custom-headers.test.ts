/**
 * API Integration / regression: the cron webhook-retry path must re-apply the
 * endpoint's per-endpoint custom headers on a retried delivery.
 *
 * Closes a known coverage gap. `handleWebhookDeliveriesRetry` (cron job
 * `webhook-deliveries-retry`) selects `custom_headers_encrypted` on the endpoint
 * and carries it into the dispatch slice; `WebhookDispatcher.dispatch` decrypts
 * and re-applies it on every attempt (first send AND retries). Without the slice
 * carrying that column, retries went out unauthenticated (e.g. → 401 → DLQ, PII
 * posted without auth). This test drives the real cron handler end-to-end against
 * local Supabase and asserts the decrypted header lands on the wire.
 *
 * The dispatcher's real HTTP send targets `example.com` which Sellf's SSRF guard
 * would resolve/reject — so, exactly like the dispatcher-custom-headers unit test,
 * we intercept undici (capture `init.headers`) and stub the SSRF agent + URL
 * validator rather than weakening the production guards. No real network egress.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';

// Capture every outbound webhook request, keyed by URL, so an assertion can find
// THIS endpoint's request even if unrelated due deliveries are dispatched in the
// same batch.
const capturedByUrl = new Map<string, Record<string, string>>();
vi.mock('undici', () => ({
  fetch: vi.fn(async (url: string, init: any) => {
    capturedByUrl.set(url, init.headers);
    return { ok: true, status: 200, text: async () => 'ok' };
  }),
}));
vi.mock('@/lib/security/safe-fetch', () => ({ getSsrfSafeAgent: vi.fn(() => undefined) }));
vi.mock('@/lib/validations/webhook', () => ({
  validateWebhookUrlAsync: vi.fn(async () => ({ valid: true })),
}));

// Import the cron handler AFTER the mocks so the dispatcher it pulls in binds to
// the mocked undici.
const { handleWebhookDeliveriesRetry } = await import('@/app/api/cron/route');

const admin = createClient(
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Unique URL so this test's request is unambiguous in capturedByUrl.
const HOOK_URL = `https://example.com/h-${Math.random().toString(36).slice(2, 10)}`;

let endpointId: string;
let logId: string;

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

  const custom_headers_encrypted = await encryptHeaderMap({ Authorization: 'Bearer RT' });
  const { data: endpoint, error: epErr } = await admin
    .from('webhook_endpoints')
    .insert({
      url: HOOK_URL,
      events: ['purchase.completed'],
      is_active: true,
      secret: 's',
      product_filter_mode: 'all',
      custom_headers_encrypted,
    })
    .select('id')
    .single();
  if (epErr) throw epErr;
  endpointId = endpoint!.id;

  // A delivery already attempted once, now due for retry (next_retry_at in the past).
  const { data: log, error: logErr } = await admin
    .from('webhook_logs')
    .insert({
      endpoint_id: endpointId,
      event_type: 'purchase.completed',
      payload: { event: 'purchase.completed', data: {} },
      status: 'pending_retry',
      attempt_count: 1,
      max_attempts: 3,
      next_retry_at: new Date(Date.now() - 5_000).toISOString(),
      http_status: 503,
      duration_ms: 0,
    })
    .select('id')
    .single();
  if (logErr) throw logErr;
  logId = log!.id;
});

afterAll(async () => {
  if (logId) await admin.from('webhook_logs').delete().eq('id', logId);
  if (endpointId) await admin.from('webhook_endpoints').delete().eq('id', endpointId);
});

describe('cron webhook-deliveries-retry re-applies custom headers', () => {
  it('carries the decrypted Authorization header on the retried delivery', async () => {
    const result = await handleWebhookDeliveriesRetry();
    // At least our delivery was processed (other due rows may also be picked up).
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const headers = capturedByUrl.get(HOOK_URL);
    expect(headers, 'expected the retry to dispatch to our endpoint URL').toBeDefined();
    // The decrypted per-endpoint custom header is re-applied on the retry…
    expect(headers!['Authorization']).toBe('Bearer RT');
    // …alongside the dispatcher-owned signature header.
    expect(headers!['X-Sellf-Signature']).toBeDefined();
  });
});
