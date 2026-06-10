/**
 * End-to-end matrix: every webhook customization combination in one file.
 *
 * Drives WebhookService.testEndpoint(id, 'purchase.completed') with HTTP mocked
 * (same undici intercept as webhook-test-endpoint-customization.test.ts) and
 * asserts the captured outgoing request for each combination:
 *
 *   1. plain          — no customization at all
 *   2. headers-only   — custom_headers_encrypted only
 *   3. fields-only    — custom_payload_fields only (with placeholder)
 *   4. selection-only — payload_field_selection only (keep one key)
 *   5. deselect-all   — payload_field_selection = [] (empty → empty data)
 *   6. all-three      — headers + extra fields + field selection together
 *
 * Each it() seeds a fresh endpoint (inert events: ['test.event']), calls
 * testEndpoint, asserts, then cleans up via afterAll.  The captured object is
 * reset in beforeEach so no leakage between cases even under Vitest retry:1.
 *
 * @see tests/api/webhook-test-endpoint-customization.test.ts (setup reference)
 * @see src/lib/webhooks/mock-payloads.ts   (WEBHOOK_MOCK_PAYLOADS shape)
 * @see src/lib/services/webhook-service.ts (testEndpoint)
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';

// ── HTTP layer mocks (must precede the service import) ──────────────────────
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

// ── Supabase admin client ───────────────────────────────────────────────────
const admin = createClient(
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Set encryption key once for the whole module (same value used by the reference test).
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.DEMO_MODE = 'true'; // ensures 'business' tier so customization is not gated

// ── Endpoint registry: collect every id created so afterAll can purge them ──
const createdIds: string[] = [];

/** Seed a webhook_endpoints row and return its id. */
async function seedEndpoint(overrides: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin
    .from('webhook_endpoints')
    .insert({
      url: 'https://example.com/combos-test',
      // INERT event so no sibling trigger('purchase.completed') can pick this up.
      events: ['test.event'],
      is_active: true,
      secret: 's',
      product_filter_mode: 'all',
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedEndpoint: ${error?.message}`);
  createdIds.push(data.id);
  return data.id;
}

// ── Shorthand alias for the nested mock payload ─────────────────────────────
const M = WEBHOOK_MOCK_PAYLOADS['purchase.completed'];

// ── Reset captured request before every test ────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  captured.headers = undefined;
  captured.body = undefined;
});

// ── Cleanup all seeded endpoints + their log rows ───────────────────────────
afterAll(async () => {
  for (const id of createdIds) {
    await admin.from('webhook_logs').delete().eq('endpoint_id', id);
    await admin.from('webhook_endpoints').delete().eq('id', id);
  }
  delete process.env.DEMO_MODE;
});

// ── Matrix ───────────────────────────────────────────────────────────────────
describe('webhook customization combination matrix', () => {
  it('1 plain: no customization — full data, no extra fields, no Authorization', async () => {
    const id = await seedEndpoint({});
    await WebhookService.testEndpoint(id, 'purchase.completed');

    // No Authorization header injected.
    expect(captured.headers!['Authorization']).toBeUndefined();

    // Owned headers always present as a sanity check.
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();

    // body.data is the full mock payload (no field selection applied).
    expect(captured.body.data).toEqual(M);

    // No extra top-level keys beyond event / timestamp / data.
    const topLevel = Object.keys(captured.body);
    expect(topLevel.sort()).toEqual(['data', 'event', 'timestamp'].sort());
  });

  it('2 headers-only: custom_headers_encrypted only — Authorization injected, full data', async () => {
    const enc = await encryptHeaderMap({ Authorization: 'Bearer K1' });
    const id = await seedEndpoint({ custom_headers_encrypted: enc });
    await WebhookService.testEndpoint(id, 'purchase.completed');

    expect(captured.headers!['Authorization']).toBe('Bearer K1');
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();

    // Field selection unchanged — full payload in data.
    expect(captured.body.data).toEqual(M);

    // No extra top-level keys.
    const topLevel = Object.keys(captured.body);
    expect(topLevel.sort()).toEqual(['data', 'event', 'timestamp'].sort());
  });

  it('3 fields-only: custom_payload_fields only — extra fields rendered, full data', async () => {
    const id = await seedEndpoint({
      custom_payload_fields: { brand: 'tsa', to: '{{email}}' },
    });
    await WebhookService.testEndpoint(id, 'purchase.completed');

    expect(captured.headers!['Authorization']).toBeUndefined();
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();

    // Static extra field.
    expect(captured.body.brand).toBe('tsa');

    // Placeholder resolved against the nested mock: customer.email.
    expect(captured.body.to).toBe(M.customer.email);

    // Full payload still present in data.
    expect(captured.body.data).toEqual(M);
  });

  it('4 selection-only: payload_field_selection=[order] — data keeps only order', async () => {
    const id = await seedEndpoint({ payload_field_selection: ['order'] });
    await WebhookService.testEndpoint(id, 'purchase.completed');

    expect(captured.headers!['Authorization']).toBeUndefined();
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();

    // data contains only the requested key.
    expect(captured.body.data).toEqual({ order: M.order });

    // No extra top-level keys.
    const topLevel = Object.keys(captured.body);
    expect(topLevel.sort()).toEqual(['data', 'event', 'timestamp'].sort());
  });

  it('5 deselect-all: payload_field_selection=[] — data is empty object', async () => {
    const id = await seedEndpoint({ payload_field_selection: [] });
    await WebhookService.testEndpoint(id, 'purchase.completed');

    expect(captured.headers!['Authorization']).toBeUndefined();
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();

    expect(captured.body.data).toEqual({});

    // No extra top-level keys.
    const topLevel = Object.keys(captured.body);
    expect(topLevel.sort()).toEqual(['data', 'event', 'timestamp'].sort());
  });

  it('6 all-three: headers + extra fields + field selection — full combo', async () => {
    const enc = await encryptHeaderMap({ Authorization: 'Bearer K6' });
    const id = await seedEndpoint({
      custom_headers_encrypted: enc,
      custom_payload_fields: { brand: 'tsa' },
      payload_field_selection: ['order', 'customer'],
    });
    await WebhookService.testEndpoint(id, 'purchase.completed');

    // Custom header present.
    expect(captured.headers!['Authorization']).toBe('Bearer K6');
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();

    // Extra field rendered.
    expect(captured.body.brand).toBe('tsa');

    // Exactly the two selected keys in data.
    expect(Object.keys(captured.body.data).sort()).toEqual(['customer', 'order'].sort());
    expect(captured.body.data).toEqual({ order: M.order, customer: M.customer });
  });
});
