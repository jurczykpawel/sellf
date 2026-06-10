/**
 * v1 GET read-extension: custom_payload_fields, payload_field_selection, has_custom_headers.
 *
 * Proves Task 1: GET /api/v1/webhooks/:id returns the non-secret customization
 * fields and a boolean `has_custom_headers` flag, but NEVER returns the raw
 * `custom_headers_encrypted` blob or the plaintext header values.
 *
 * Harness: identical mock/setup to webhook-customization-api.test.ts — handler
 * import + mocked `@/lib/api` authenticate() that yields a real service-role
 * Supabase client.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars for webhook-customization-read tests');
}

// Real service-role client used both by the mocked auth layer and by cleanup.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mock ONLY the auth seam — authenticate() returns the real service-role client.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authenticate: vi.fn(async () => ({
      method: 'api_key',
      supabase: admin,
      admin: { userId: 'test-user', adminId: 'test-admin', email: null },
      apiKey: { id: 'test-key', name: 'vitest', scopes: ['*'], rateLimitPerMinute: 1000 },
      scopes: ['*'],
    })),
  };
});

// Imported AFTER the mock so the handlers bind to the mocked authenticate().
const { POST } = await import('@/app/api/v1/webhooks/route');
const { GET } = await import('@/app/api/v1/webhooks/[id]/route');

const createdEndpointIds: string[] = [];

function makeReq(method: 'POST' | 'GET', body?: unknown): import('next/server').NextRequest {
  return new Request('http://localhost/api/v1/webhooks', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as import('next/server').NextRequest;
}

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

afterEach(() => {
  delete process.env.DEMO_MODE;
});

afterAll(async () => {
  if (createdEndpointIds.length > 0) {
    await admin.from('webhook_endpoints').delete().in('id', createdEndpointIds);
  }
});

describe('v1 GET returns non-secret customization + has_custom_headers', () => {
  it('exposes fields + boolean, never the encrypted blob/values', async () => {
    process.env.DEMO_MODE = 'true';
    const created = await POST(makeReq('POST', {
      url: 'https://example.com/h', events: ['purchase.completed'],
      custom_headers: { Authorization: 'Bearer sk_secret' },
      custom_payload_fields: { brand: 'tsa' }, payload_field_selection: ['order'],
    }) as any);
    const { data: createdBody } = await created.json();
    const id = createdBody.id;
    createdEndpointIds.push(id);

    const res = await GET(makeReq('GET') as any, { params: Promise.resolve({ id }) } as any);
    const json = await res.json();
    const ep = json.data;
    expect(ep.custom_payload_fields).toEqual({ brand: 'tsa' });
    expect(ep.payload_field_selection).toEqual(['order']);
    expect(ep.has_custom_headers).toBe(true);
    // The KEY NAMES are returned (so the edit form can list them)…
    expect(ep.custom_header_names).toEqual(['Authorization']);
    // …but never the encrypted blob, and never the secret VALUE.
    expect(ep.custom_headers_encrypted).toBeUndefined();
    expect(JSON.stringify(ep)).not.toContain('sk_secret');
  });
});
