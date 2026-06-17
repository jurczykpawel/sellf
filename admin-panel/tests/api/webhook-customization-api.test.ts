/**
 * v1 Webhooks API — payload-customization license gate + header encryption.
 *
 * Proves Task 8: creating/updating a webhook endpoint with `custom_headers`
 * (or `custom_payload_fields` / `payload_field_selection`) is:
 *   - rejected with 403 on the free tier (no license, DEMO_MODE unset), and
 *   - allowed on Pro/business (DEMO_MODE=true), persisting the headers ENCRYPTED
 *     (the plaintext bearer value never lands in the stored column).
 *
 * Harness: handler-import (NextRequest → route handler), the same seam used by
 * tests/unit/subscriptions-api.integration.test.ts. We mock `@/lib/api` so
 * `authenticate()` hands the handler a real service-role Supabase client (rows
 * truly persist, so we can read back `custom_headers_encrypted`) while every
 * other api helper (apiError/parseJsonBody/handleApiError/successResponse/…)
 * stays real. The license tier is driven purely by process.env (DEMO_MODE),
 * which `checkFeature` honours — so a single in-process run can exercise BOTH
 * the free-rejected and Pro-allowed branches. A live HTTP server can't flip its
 * own tier mid-run, which is why this lives under the unit runner.
 *
 * Despite the tests/api/ path, this file imports the handler directly and does
 * NOT need a running dev server; run it with the unit runner:
 *   bunx vitest run tests/api/webhook-customization-api.test.ts
 *
 * @see src/app/api/v1/webhooks/route.ts (POST)
 * @see src/app/api/v1/webhooks/[id]/route.ts (PATCH)
 * @see src/lib/webhooks/custom-headers.ts (encryptHeaderMap)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars for webhook customization API tests');
}

// Real service-role client: used both by the mocked auth layer (so the handler's
// `.insert/.update` actually hit Postgres) and by the test itself for read-back
// + cleanup.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mock ONLY the auth seam — authenticate() returns the real service-role client
// as `.supabase`; every other @/lib/api export passes through untouched.
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
const { PATCH } = await import('@/app/api/v1/webhooks/[id]/route');

// The plaintext secret that must NEVER appear in the persisted column.
const BEARER = 'super-secret-bearer-value-xyz';
const CUSTOM_HEADERS = { Authorization: `Bearer ${BEARER}` };

const TS = Date.now();
const RAND = Math.random().toString(36).slice(2, 6);

const createdEndpointIds: string[] = [];

function postReq(body: unknown): import('next/server').NextRequest {
  return new Request('http://localhost/api/v1/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function patchReq(body: unknown): import('next/server').NextRequest {
  return new Request('http://localhost/api/v1/webhooks/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function asResponse(res: unknown): { status: number; json: () => Promise<any> } {
  return res as { status: number; json: () => Promise<any> };
}

/** Insert a bare endpoint directly (for PATCH cases) and track it for cleanup. */
async function seedEndpoint(): Promise<string> {
  const { data, error } = await admin
    .from('webhook_endpoints')
    .insert({
      url: `https://example.com/cust-patch-${TS}-${RAND}-${createdEndpointIds.length}`,
      events: ['payment.completed'],
      is_active: true,
      secret: `whsec_cust_${RAND}_${createdEndpointIds.length}`,
      product_filter_mode: 'all',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedEndpoint failed: ${error?.message}`);
  createdEndpointIds.push(data.id);
  return data.id;
}

let savedLicenseKey: string | undefined;
let savedDbLicense: string | null = null;

beforeAll(async () => {
  // Pro/business path needs a valid 32-byte key for encryptHeaderMap.
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

  // Force a deterministic 'free' baseline for the free-tier cases, independent of
  // any ambient license in .env.local (the api runner loads it). Pro cases set
  // DEMO_MODE='true', which wins over both the env and DB license sources.
  savedLicenseKey = process.env.SELLF_LICENSE_KEY;
  delete process.env.SELLF_LICENSE_KEY;
  const { data: cfg } = await admin
    .from('integrations_config').select('sellf_license').eq('id', 1).maybeSingle();
  savedDbLicense = (cfg as { sellf_license: string | null } | null)?.sellf_license ?? null;
  if (savedDbLicense !== null) {
    await admin.from('integrations_config').update({ sellf_license: null }).eq('id', 1);
  }
});

afterEach(() => {
  // Each test sets the tier it wants; never leak DEMO_MODE between cases
  // (the unit runner runs files in one process).
  delete process.env.DEMO_MODE;
});

afterAll(async () => {
  if (createdEndpointIds.length > 0) {
    await admin.from('webhook_endpoints').delete().in('id', createdEndpointIds);
  }
  // Restore the ambient tier state we changed in beforeAll.
  if (savedLicenseKey !== undefined) process.env.SELLF_LICENSE_KEY = savedLicenseKey;
  if (savedDbLicense !== null) {
    await admin.from('integrations_config').update({ sellf_license: savedDbLicense }).eq('id', 1);
  }
});

describe('POST /api/v1/webhooks — payload customization gate', () => {
  it('rejects custom_headers on the free tier with 403', async () => {
    delete process.env.DEMO_MODE; // free tier (no license configured)

    const res = asResponse(
      await POST(
        postReq({
          url: `https://example.com/cust-free-${TS}-${RAND}`,
          events: ['payment.completed'],
          custom_headers: CUSTOM_HEADERS,
        }),
      ),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');

    // Defensive: a 403 must NOT have created a row.
    const { data } = await admin
      .from('webhook_endpoints')
      .select('id')
      .eq('url', `https://example.com/cust-free-${TS}-${RAND}`)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('allows custom_headers on Pro/DEMO and persists them encrypted (no plaintext)', async () => {
    process.env.DEMO_MODE = 'true'; // tier business → customization allowed

    const url = `https://example.com/cust-pro-${TS}-${RAND}`;
    const res = asResponse(
      await POST(
        postReq({
          url,
          events: ['payment.completed'],
          custom_headers: CUSTOM_HEADERS,
        }),
      ),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBeDefined();
    createdEndpointIds.push(body.data.id);

    // Read the persisted row directly: the encrypted column is non-null and the
    // plaintext bearer value is nowhere in the stored ciphertext.
    const { data: row } = await admin
      .from('webhook_endpoints')
      .select('custom_headers_encrypted')
      .eq('id', body.data.id)
      .single();

    expect(row!.custom_headers_encrypted).not.toBeNull();
    expect(typeof row!.custom_headers_encrypted).toBe('string');
    expect(row!.custom_headers_encrypted as string).not.toContain(BEARER);
  });

  it('rejects custom_payload_fields on the free tier with 403', async () => {
    delete process.env.DEMO_MODE;

    const res = asResponse(
      await POST(
        postReq({
          url: `https://example.com/cust-free-fields-${TS}-${RAND}`,
          events: ['payment.completed'],
          custom_payload_fields: { brand: 'tsa' },
        }),
      ),
    );

    expect(res.status).toBe(403);
  });

  it('rejects payload_field_selection on the free tier with 403', async () => {
    delete process.env.DEMO_MODE;

    const res = asResponse(
      await POST(
        postReq({
          url: `https://example.com/cust-free-sel-${TS}-${RAND}`,
          events: ['payment.completed'],
          payload_field_selection: ['email'],
        }),
      ),
    );

    expect(res.status).toBe(403);
  });

  it('leaves a customization-free request unchanged (no new columns set)', async () => {
    // A tier allowed to create webhooks (creation itself is now Registered+),
    // with NO customization fields — must succeed and persist no customization
    // columns. The customization gate only fires when those fields are present.
    process.env.DEMO_MODE = 'true';

    const url = `https://example.com/cust-none-${TS}-${RAND}`;
    const res = asResponse(
      await POST(
        postReq({
          url,
          events: ['payment.completed'],
        }),
      ),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    createdEndpointIds.push(body.data.id);

    const { data: row } = await admin
      .from('webhook_endpoints')
      .select('custom_headers_encrypted, custom_payload_fields, payload_field_selection')
      .eq('id', body.data.id)
      .single();
    expect(row!.custom_headers_encrypted).toBeNull();
    expect(row!.custom_payload_fields).toBeNull();
    expect(row!.payload_field_selection).toBeNull();
  });
});

describe('PATCH /api/v1/webhooks/:id — payload customization gate', () => {
  it('rejects custom_headers on the free tier with 403', async () => {
    delete process.env.DEMO_MODE;
    const id = await seedEndpoint();

    const res = asResponse(
      await PATCH(patchReq({ custom_headers: CUSTOM_HEADERS }), {
        params: Promise.resolve({ id }),
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');

    // Row must be untouched.
    const { data: row } = await admin
      .from('webhook_endpoints')
      .select('custom_headers_encrypted')
      .eq('id', id)
      .single();
    expect(row!.custom_headers_encrypted).toBeNull();
  });

  it('allows custom_headers on Pro/DEMO and persists them encrypted (no plaintext)', async () => {
    process.env.DEMO_MODE = 'true';
    const id = await seedEndpoint();

    const res = asResponse(
      await PATCH(patchReq({ custom_headers: CUSTOM_HEADERS }), {
        params: Promise.resolve({ id }),
      }),
    );

    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('webhook_endpoints')
      .select('custom_headers_encrypted')
      .eq('id', id)
      .single();
    expect(row!.custom_headers_encrypted).not.toBeNull();
    expect(typeof row!.custom_headers_encrypted).toBe('string');
    expect(row!.custom_headers_encrypted as string).not.toContain(BEARER);
  });

  it('leaves a customization-free PATCH unchanged (no gate)', async () => {
    delete process.env.DEMO_MODE; // free tier
    const id = await seedEndpoint();

    const res = asResponse(
      await PATCH(patchReq({ is_active: false }), {
        params: Promise.resolve({ id }),
      }),
    );

    expect(res.status).toBe(200);
    const { data: row } = await admin
      .from('webhook_endpoints')
      .select('is_active, custom_headers_encrypted')
      .eq('id', id)
      .single();
    expect(row!.is_active).toBe(false);
    expect(row!.custom_headers_encrypted).toBeNull();
  });
});
