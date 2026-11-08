import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';

// Capture the outbound webhook request. The dispatcher's real HTTP send targets a
// loopback test server, which Sellf's SSRF guard (correctly) blocks. Rather than
// weaken that production guard, intercept the dispatcher's HTTP layer the same way
// the dispatcher-custom-headers unit test does, and assert on what trigger() built:
// custom header, extra placeholder-rendered fields, and the field-selected `data`.
const captured: { headers?: Record<string, string>; body?: any; deliveries: Map<string, any> } = { deliveries: new Map() };
vi.mock('undici', () => ({
  fetch: vi.fn(async (_url: string, init: any) => {
    captured.headers = init.headers;
    captured.body = JSON.parse(init.body);
    if (init.headers['X-Sellf-Delivery-Id']) captured.deliveries.set(init.headers['X-Sellf-Delivery-Id'], captured.body);
    return new Response(init.body, { status: 200 });
  }),
}));
vi.mock('@/lib/security/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/safe-fetch')>()),
  getSsrfSafeAgent: vi.fn(() => undefined),
}));
vi.mock('@/lib/validations/webhook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/validations/webhook')>()),
  validateWebhookUrlAsync: vi.fn(async () => ({ valid: true })),
}));

// Imported after the mocks so the dispatcher binds to the mocked undici.
const { WebhookService } = await import('@/lib/services/webhook-service');

const admin = createClient(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!);

let endpointId: string;

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.DEMO_MODE = 'true'; // forces tier 'business' so customization is allowed
  const enc = await encryptHeaderMap({ Authorization: 'Bearer T' });
  const { data } = await admin.from('webhook_endpoints').insert({
    url: 'https://example.com/hook', events: ['purchase.completed'], is_active: true,
    secret: 'whsec_test', product_filter_mode: 'all',
    custom_headers_encrypted: enc,
    custom_payload_fields: { brand: 'tsa', to: '{{email}}', amount: '{{amount_major}}' },
    payload_field_selection: ['order'],
  }).select('id').single();
  endpointId = data!.id;
});

afterAll(async () => { await admin.from('webhook_endpoints').delete().eq('id', endpointId); delete process.env.DEMO_MODE; });

describe('trigger applies endpoint customization', () => {
  it('sends selected data + extra fields + custom header (real nested purchase payload) @J72', async () => {
    // The REAL purchase.completed payload is the nested PurchaseWebhookData
    // (customer/product/order), not a flat object. This is the shape that
    // {{email}}/{{amount_major}} and the field selection must resolve against.
    await WebhookService.trigger('purchase.completed', {
      customer: { email: 'a@b.com' },
      order: { amount: 14900, currency: 'usd', paymentIntentId: 'pi_X' },
      product: { name: 'Webinar', slug: 'webinar' },
    }, admin);
    expect(captured.headers!['Authorization']).toBe('Bearer T');
    expect(captured.body.brand).toBe('tsa');
    expect(captured.body.to).toBe('a@b.com');
    expect(captured.body.amount).toBe('149.00'); // {{amount_major}} from order.amount (cents)
    // Field selection keeps the real top-level `order` key; customer/product dropped.
    expect(captured.body.data).toEqual({ order: { amount: 14900, currency: 'usd', paymentIntentId: 'pi_X' } });
  });
});

it('keeps order links in delivery and returns the stored payload from the logs API @J72', async () => {
  const { error } = await admin.from('webhook_endpoints').update({ events: ['order.placed'], custom_payload_fields: null, payload_field_selection: null }).eq('id', endpointId);
  expect(error).toBeNull();
  const payUrl = 'https://example.com/en/order/test/transfer?token=order-link-fixture';
  await WebhookService.trigger('order.placed', { customer: { email: 'a@b.com' }, order: { payUrl } }, admin);
  expect(captured.body.data.order.payUrl).toBe(payUrl);
  const stored = await admin.from('webhook_logs').select('payload, response_body, status, http_status').eq('endpoint_id', endpointId).eq('event_type', 'order.placed').single();
  expect(stored.error).toBeNull();
  expect(stored.data).toMatchObject({ response_body: null, status: 'success', http_status: 200 });
  expect(JSON.stringify(stored.data)).not.toContain('order-link-fixture');
  const response = await fetch(`${process.env.TEST_API_URL || 'http://localhost:3777'}/api/v1/webhooks/logs?endpoint_id=${endpointId}`, { headers: { Authorization: `Bearer ${process.env.TEST_API_KEY_PLAINTEXT}` } });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('order-link-fixture');
});

it.each(['manual', 'cron'])('retains order delivery metadata after %s retry @J72', async mode => {
  const { storeBuyerPayload } = await import('@/lib/webhooks/buyer-payload-storage');
  const outgoing = { event: 'order.placed', data: { order: { payUrl: 'https://example.com/pay?token=retry-order-fixture' } } };
  const { data: row, error } = await admin.from('webhook_logs').insert({
    endpoint_id: endpointId, event_type: 'order.placed',
    payload: await storeBuyerPayload('order.placed', outgoing),
    status: mode === 'manual' ? 'failed' : 'pending_retry',
    attempt_count: 1, max_attempts: 5, next_retry_at: new Date(0).toISOString(),
  }).select('id').single();
  expect(error).toBeNull();
  try {
    if (mode === 'manual') expect(await WebhookService.retry(row!.id, admin)).toMatchObject({ success: true, status: 200 });
    else {
      const { handleWebhookDeliveriesRetry } = await import('@/app/api/cron/route');
      expect((await handleWebhookDeliveriesRetry()).processed).toBeGreaterThan(0);
    }
    expect(captured.deliveries.get(row!.id)?.data.order.payUrl).toBe(outgoing.data.order.payUrl);
    const stored = await admin.from('webhook_logs').select('*').eq('id', row!.id).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ status: 'success', http_status: 200, response_body: null, attempt_count: 2 });
    expect(JSON.stringify(stored.data)).not.toContain('retry-order-fixture');
    const response = await fetch(`${process.env.TEST_API_URL || 'http://localhost:3777'}/api/v1/webhooks/logs?endpoint_id=${endpointId}`, { headers: { Authorization: `Bearer ${process.env.TEST_API_KEY_PLAINTEXT}` } });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('retry-order-fixture');
  } finally {
    await admin.from('webhook_logs').delete().eq('id', row!.id);
  }
});
