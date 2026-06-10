import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';

// Capture the outbound webhook request. The dispatcher's real HTTP send targets a
// loopback test server, which Sellf's SSRF guard (correctly) blocks. Rather than
// weaken that production guard, intercept the dispatcher's HTTP layer the same way
// the dispatcher-custom-headers unit test does, and assert on what trigger() built:
// custom header, extra placeholder-rendered fields, and the field-selected `data`.
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
  it('sends selected data + extra fields + custom header (real nested purchase payload)', async () => {
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
