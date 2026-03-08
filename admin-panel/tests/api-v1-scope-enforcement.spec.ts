/**
 * API v1 Scope Enforcement Tests
 *
 * Verifies that API key scope restrictions are enforced at the HTTP level
 * across all resource types. Complements unit tests for `hasScope()` by
 * proving each route handler correctly calls `authenticate(request, [scope])`.
 *
 * Strategy (3 keys, ~14 assertions):
 *   Key 1 — `products:read` only  → own read works, write blocked, all other scopes blocked
 *   Key 2 — all read scopes       → write blocked for every writable resource
 *   Key 3 — `products:write` only → write implies read (GET 200, POST scope-passes)
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Fake UUID that will never exist in DB — scope check happens before DB lookup
const FAKE_UUID = '00000000-0000-0000-0000-000000000001';

test.describe('API v1 — Scope Enforcement', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';

  // Keys created once, reused across all tests
  let productsReadKey: string;    // products:read only
  let allReadKey: string;         // all read scopes
  let productsWriteKey: string;   // products:write only
  const createdKeyIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    // Create admin user
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `scope-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Scope Tester' },
    });
    if (error) throw error;
    adminUserId = user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Log in via browser context to create API keys through the API
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await setAuthSession(page, adminEmail, adminPassword);

    async function createKey(name: string, scopes: string[]): Promise<string> {
      const res = await page.request.post('/api/v1/api-keys', {
        data: { name, scopes },
      });
      if (!res.ok()) {
        throw new Error(`Failed to create key "${name}": ${res.status()} ${await res.text()}`);
      }
      const body = await res.json();
      createdKeyIds.push(body.data.id);
      return body.data.key;
    }

    productsReadKey  = await createKey('scope-test: products:read',  ['products:read']);
    allReadKey       = await createKey('scope-test: all-read',       [
      'products:read', 'users:read', 'coupons:read',
      'analytics:read', 'webhooks:read', 'refund-requests:read', 'system:read',
    ]);
    productsWriteKey = await createKey('scope-test: products:write', ['products:write']);

    await context.close();
  });

  test.afterAll(async () => {
    for (const id of createdKeyIds) {
      await supabaseAdmin.from('api_key_audit_log').delete().eq('api_key_id', id);
      await supabaseAdmin.from('api_keys').delete().eq('id', id);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  // ─── Key 1: products:read ────────────────────────────────────────────────

  test.describe('products:read — own scope', () => {
    test('GET /products → 200 (read allowed)', async ({ request }) => {
      const res = await request.get('/api/v1/products', {
        headers: { Authorization: `Bearer ${productsReadKey}` },
      });
      expect(res.status()).toBe(200);
    });

    test('POST /products → 403 (write blocked)', async ({ request }) => {
      const res = await request.post('/api/v1/products', {
        headers: { Authorization: `Bearer ${productsReadKey}` },
        data: { name: 'Should Fail' },
      });
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  test.describe('products:read — cross-scope isolation', () => {
    const cases: Array<[string, string]> = [
      ['GET /users',               '/api/v1/users'],
      ['GET /coupons',             '/api/v1/coupons'],
      ['GET /analytics/dashboard', '/api/v1/analytics/dashboard'],
      ['GET /webhooks',            '/api/v1/webhooks'],
      ['GET /refund-requests',     '/api/v1/refund-requests'],
      ['GET /system/status',       '/api/v1/system/status'],
    ];

    for (const [label, path] of cases) {
      test(`${label} → 403 (cross-scope)`, async ({ request }) => {
        const res = await request.get(path, {
          headers: { Authorization: `Bearer ${productsReadKey}` },
        });
        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe('FORBIDDEN');
      });
    }
  });

  // ─── Key 2: all read scopes — write operations ────────────────────────────

  test.describe('all-read key — write operations blocked', () => {
    test('POST /products → 403', async ({ request }) => {
      const res = await request.post('/api/v1/products', {
        headers: { Authorization: `Bearer ${allReadKey}` },
        data: { name: 'Should Fail' },
      });
      expect(res.status()).toBe(403);
    });

    test('POST /coupons → 403', async ({ request }) => {
      const res = await request.post('/api/v1/coupons', {
        headers: { Authorization: `Bearer ${allReadKey}` },
        data: { code: 'FAIL' },
      });
      expect(res.status()).toBe(403);
    });

    test('POST /webhooks → 403', async ({ request }) => {
      const res = await request.post('/api/v1/webhooks', {
        headers: { Authorization: `Bearer ${allReadKey}` },
        data: { url: 'https://example.com', events: ['access.granted'] },
      });
      expect(res.status()).toBe(403);
    });

    test('PATCH /refund-requests/:id → 403', async ({ request }) => {
      const res = await request.patch(`/api/v1/refund-requests/${FAKE_UUID}`, {
        headers: { Authorization: `Bearer ${allReadKey}` },
        data: { action: 'approve' },
      });
      expect(res.status()).toBe(403);
    });

    test('POST /system/upgrade → 403', async ({ request }) => {
      const res = await request.post('/api/v1/system/upgrade', {
        headers: { Authorization: `Bearer ${allReadKey}` },
        data: {},
      });
      expect(res.status()).toBe(403);
    });
  });

  // ─── Key 3: products:write — write implies read ───────────────────────────

  test.describe('products:write — write implies read', () => {
    test('GET /products → 200 (write scope grants read)', async ({ request }) => {
      const res = await request.get('/api/v1/products', {
        headers: { Authorization: `Bearer ${productsWriteKey}` },
      });
      expect(res.status()).toBe(200);
    });

    test('POST /products with bad body → 422 not 403 (scope passes)', async ({ request }) => {
      const res = await request.post('/api/v1/products', {
        headers: { Authorization: `Bearer ${productsWriteKey}` },
        data: {},
      });
      // Scope check passes — request fails at validation (422), not authorization (403)
      expect(res.status()).not.toBe(403);
      expect(res.status()).not.toBe(401);
    });

    test('GET /users → 403 (products:write cannot access users scope)', async ({ request }) => {
      const res = await request.get('/api/v1/users', {
        headers: { Authorization: `Bearer ${productsWriteKey}` },
      });
      expect(res.status()).toBe(403);
    });
  });
});
