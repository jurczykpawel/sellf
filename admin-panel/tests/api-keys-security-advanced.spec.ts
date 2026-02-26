/**
 * API Keys Advanced Security Tests
 *
 * Tests for:
 * 1. key_hash is NEVER exposed in any API response
 * 2. IDOR prevention - admin cannot access another admin's keys
 * 3. Key enumeration prevention
 * 4. Brute force protection (invalid key format)
 * 5. SQL injection attempts
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to hash API key (same as in the application)
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to generate valid format API key
function generateTestKey(): string {
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `gf_live_${randomHex}`;
}

test.describe('API Keys Security - Hash Exposure Prevention', () => {
  let testApiKeyId: string;
  let testAuthUserId: string;
  let testAdminRowId: string;
  const timestamp = Date.now();
  const adminEmail = `hash-test-admin-${timestamp}@test.com`;
  const adminPassword = 'TestPassword123!';

  // Helper to login via browser
  async function loginAsAdmin(page: any) {
    await page.goto('/login');
    await page.evaluate(async ({ email, password, url, anonKey }: { email: string; password: string; url: string; anonKey: string }) => {
      // @ts-ignore
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const sb = createBrowserClient(url, anonKey);
      await sb.auth.signInWithPassword({ email, password });
    }, {
      email: adminEmail,
      password: adminPassword,
      url: SUPABASE_URL,
      anonKey: ANON_KEY
    });
    await page.reload();
  }

  test.beforeAll(async () => {
    // Create test admin
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (authError) throw authError;
    testAuthUserId = authData.user.id;

    const { data: adminRow, error: adminInsertError } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: testAuthUserId })
      .select('id')
      .single();
    if (adminInsertError) throw adminInsertError;
    testAdminRowId = adminRow.id;

    // Create a test API key
    const keyValue = generateTestKey();
    const keyHash = await hashKey(keyValue);

    const { data: key, error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        name: 'Hash Exposure Test Key',
        key_hash: keyHash,
        key_prefix: keyValue.substring(0, 12),
        scopes: ['*'],
        is_active: true,
        admin_user_id: testAdminRowId,
      })
      .select('id')
      .single();
    if (error) throw error;
    testApiKeyId = key.id;
  });

  test.afterAll(async () => {
    if (testApiKeyId) {
      await supabaseAdmin.from('api_keys').delete().eq('id', testApiKeyId);
    }
    if (testAdminRowId) {
      await supabaseAdmin.from('admin_users').delete().eq('id', testAdminRowId);
    }
    if (testAuthUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testAuthUserId);
    }
  });

  test('GET /api/v1/api-keys should NOT return key_hash', async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.request.get('/api/v1/api-keys');

    expect(response.status()).toBe(200);
    const json = await response.json();
    const responseText = JSON.stringify(json);

    // Verify key_hash is not in the response
    expect(responseText).not.toContain('key_hash');

    // Verify the response structure — we created a key in beforeAll, so data must exist
    expect(json.data).toBeDefined();
    expect(json.data.length).toBeGreaterThan(0);
    const key = json.data[0];
    expect(key).not.toHaveProperty('key_hash');
    expect(key).toHaveProperty('key_prefix'); // Only prefix should be visible
  });

  test('GET /api/v1/api-keys/:id should NOT return key_hash', async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.request.get(`/api/v1/api-keys/${testApiKeyId}`);

    expect(response.status()).toBe(200);
    const json = await response.json();
    const responseText = JSON.stringify(json);

    expect(responseText).not.toContain('key_hash');
    expect(json.data).not.toHaveProperty('key_hash');
  });

  test('POST /api/v1/api-keys should NOT return key_hash (only plaintext key once)', async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.request.post('/api/v1/api-keys', {
      data: {
        name: 'Test Key for Hash Check',
        scopes: ['products:read'],
      },
    });

    expect(response.status()).toBe(201);
    const json = await response.json();
    const responseText = JSON.stringify(json);

    // Should have 'key' (plaintext) but NOT 'key_hash'
    expect(responseText).not.toContain('key_hash');
    expect(json.data).toHaveProperty('key'); // Plaintext key returned once
    expect(json.data.key).toMatch(/^gf_live_[a-f0-9]{64}$/);

    // Cleanup
    if (json.data.id) {
      await supabaseAdmin.from('api_keys').delete().eq('id', json.data.id);
    }
  });

  test('PATCH /api/v1/api-keys/:id should NOT return key_hash', async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.request.patch(`/api/v1/api-keys/${testApiKeyId}`, {
      data: {
        name: 'Updated Name',
      },
    });

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(JSON.stringify(json)).not.toContain('key_hash');
  });
});

test.describe('API Keys Security - IDOR Prevention', () => {
  let admin1AuthId: string;
  let admin1RowId: string;
  let admin1KeyId: string;

  let admin2AuthId: string;
  let admin2RowId: string;

  const timestamp = Date.now();
  const admin1Email = `idor-admin1-${timestamp}@test.com`;
  const admin2Email = `idor-admin2-${timestamp}@test.com`;
  const password = 'TestPassword123!';

  // Helper to login via browser
  async function loginAsAdmin(page: any, email: string, pwd: string) {
    await page.goto('/login');
    await page.evaluate(async ({ email, password, url, anonKey }: { email: string; password: string; url: string; anonKey: string }) => {
      // @ts-ignore
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const sb = createBrowserClient(url, anonKey);
      await sb.auth.signInWithPassword({ email, password });
    }, {
      email,
      password: pwd,
      url: SUPABASE_URL,
      anonKey: ANON_KEY
    });
    await page.reload();
  }

  test.beforeAll(async () => {
    // Create Admin 1
    const { data: auth1 } = await supabaseAdmin.auth.admin.createUser({
      email: admin1Email,
      password,
      email_confirm: true,
    });
    admin1AuthId = auth1.user!.id;

    const { data: adminRow1 } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: admin1AuthId })
      .select('id')
      .single();
    admin1RowId = adminRow1!.id;

    // Create API key for Admin 1
    const key1 = generateTestKey();
    const { data: keyData } = await supabaseAdmin
      .from('api_keys')
      .insert({
        name: 'Admin1 Secret Key',
        key_hash: await hashKey(key1),
        key_prefix: key1.substring(0, 12),
        scopes: ['*'],
        is_active: true,
        admin_user_id: admin1RowId,
      })
      .select('id')
      .single();
    admin1KeyId = keyData!.id;

    // Create Admin 2
    const { data: auth2 } = await supabaseAdmin.auth.admin.createUser({
      email: admin2Email,
      password,
      email_confirm: true,
    });
    admin2AuthId = auth2.user!.id;

    const { data: adminRow2 } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: admin2AuthId })
      .select('id')
      .single();
    admin2RowId = adminRow2!.id;
  });

  test.afterAll(async () => {
    // Cleanup
    if (admin1RowId) {
      await supabaseAdmin.from('api_keys').delete().eq('admin_user_id', admin1RowId);
      await supabaseAdmin.from('admin_users').delete().eq('id', admin1RowId);
    }
    if (admin2RowId) {
      await supabaseAdmin.from('api_keys').delete().eq('admin_user_id', admin2RowId);
      await supabaseAdmin.from('admin_users').delete().eq('id', admin2RowId);
    }
    if (admin1AuthId) {
      await supabaseAdmin.auth.admin.deleteUser(admin1AuthId);
    }
    if (admin2AuthId) {
      await supabaseAdmin.auth.admin.deleteUser(admin2AuthId);
    }
  });

  test('Admin2 should NOT be able to GET Admin1 key', async ({ page }) => {
    await loginAsAdmin(page, admin2Email, password);

    const response = await page.request.get(`/api/v1/api-keys/${admin1KeyId}`);

    // Should return 404, not 403 (to prevent enumeration)
    expect(response.status()).toBe(404);
  });

  test('Admin2 should NOT be able to PATCH Admin1 key', async ({ page }) => {
    await loginAsAdmin(page, admin2Email, password);

    const response = await page.request.patch(`/api/v1/api-keys/${admin1KeyId}`, {
      data: {
        name: 'Hacked by Admin2',
        scopes: ['*'],
      },
    });

    expect(response.status()).toBe(404);

    // Verify key was not modified
    const { data: key } = await supabaseAdmin
      .from('api_keys')
      .select('name')
      .eq('id', admin1KeyId)
      .single();
    expect(key?.name).toBe('Admin1 Secret Key');
  });

  test('Admin2 should NOT be able to DELETE Admin1 key', async ({ page }) => {
    await loginAsAdmin(page, admin2Email, password);

    const response = await page.request.delete(`/api/v1/api-keys/${admin1KeyId}`);

    expect(response.status()).toBe(404);

    // Verify key still exists and is active
    const { data: key } = await supabaseAdmin
      .from('api_keys')
      .select('is_active, revoked_at')
      .eq('id', admin1KeyId)
      .single();
    expect(key?.is_active).toBe(true);
    expect(key?.revoked_at).toBeNull();
  });

  test('Admin2 should NOT see Admin1 keys in list', async ({ page }) => {
    await loginAsAdmin(page, admin2Email, password);

    const response = await page.request.get('/api/v1/api-keys');

    expect(response.status()).toBe(200);
    const json = await response.json();

    // Admin2 should not see Admin1's key
    const keyIds = json.data.map((k: { id: string }) => k.id);
    expect(keyIds).not.toContain(admin1KeyId);
  });
});

test.describe('API Keys Security - Invalid Key Handling', () => {
  test('Malformed key should return 401 without revealing format expectations', async ({ request }) => {
    const malformedKeys = [
      'invalid_key',
      'gf_xxx_1234567890',
      'gf_live_short',
      'gf_live_' + 'a'.repeat(100), // Too long
      '',
      'null',
      '<script>alert(1)</script>',
      "'; DROP TABLE api_keys; --",
    ];

    for (const key of malformedKeys) {
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${key}`,
        },
      });

      // Should return 401 for invalid keys
      expect(response.status()).toBe(401);

      // Error message should NOT reveal expected format
      const json = await response.json();
      expect(json.error.message).not.toContain('gf_live_');
      expect(json.error.message).not.toContain('64 characters');
      expect(json.error.message).not.toContain('hex');
    }
  });

  test('Non-existent but valid-format key should return 401', async ({ request }) => {
    const fakeKey = generateTestKey(); // Valid format but not in DB

    const response = await request.get('/api/v1/products', {
      headers: {
        'Authorization': `Bearer ${fakeKey}`,
      },
    });

    expect(response.status()).toBe(401);

    // Should not reveal whether key format is correct or key doesn't exist
    const json = await response.json();
    // Accept either generic message - important is it doesn't say "key not found in database"
    expect(['Authentication required', 'Invalid API key']).toContain(json.error.message);
  });

  test('SQL injection in key should be safely handled', async ({ request }) => {
    const sqlInjectionKeys = [
      "gf_live_' OR '1'='1",
      "gf_live_'; DROP TABLE api_keys;--",
      "gf_live_\" OR \"1\"=\"1",
      "gf_live_${malicious}",
    ];

    for (const key of sqlInjectionKeys) {
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${key}`,
        },
      });

      // Should return 401, not 500 (which would indicate SQL error)
      expect(response.status()).toBe(401);
    }
  });
});

test.describe('API Keys Security - Key Rotation', () => {
  let testAuthUserId: string;
  let testAdminRowId: string;
  let testApiKeyId: string;
  let testApiKey: string;

  test.beforeAll(async () => {
    // Setup test admin and key
    const adminEmail = `rotation-test-${Date.now()}@test.com`;
    const { data: authData } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    testAuthUserId = authData.user!.id;

    const { data: adminRow } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: testAuthUserId })
      .select('id')
      .single();
    testAdminRowId = adminRow!.id;

    testApiKey = generateTestKey();
    const { data: key } = await supabaseAdmin
      .from('api_keys')
      .insert({
        name: 'Rotation Test Key',
        key_hash: await hashKey(testApiKey),
        key_prefix: testApiKey.substring(0, 12),
        scopes: ['*'],
        is_active: true,
        admin_user_id: testAdminRowId,
      })
      .select('id')
      .single();
    testApiKeyId = key!.id;
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('api_keys').delete().eq('admin_user_id', testAdminRowId);
    await supabaseAdmin.from('admin_users').delete().eq('id', testAdminRowId);
    await supabaseAdmin.auth.admin.deleteUser(testAuthUserId);
  });

  test('Revoked key should be rejected immediately', async ({ request }) => {
    // First verify the key works
    const beforeRevoke = await request.get('/api/v1/products', {
      headers: { 'Authorization': `Bearer ${testApiKey}` },
    });
    expect(beforeRevoke.status()).toBe(200);

    // Revoke the key directly in DB
    await supabaseAdmin
      .from('api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', testApiKeyId);

    // Key should now be rejected
    const afterRevoke = await request.get('/api/v1/products', {
      headers: { 'Authorization': `Bearer ${testApiKey}` },
    });
    expect(afterRevoke.status()).toBe(401);

    // Restore for other tests
    await supabaseAdmin
      .from('api_keys')
      .update({
        is_active: true,
        revoked_at: null,
      })
      .eq('id', testApiKeyId);
  });

  test('Expired key should be rejected', async ({ request }) => {
    // Set expiration to past
    await supabaseAdmin
      .from('api_keys')
      .update({
        expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      })
      .eq('id', testApiKeyId);

    const response = await request.get('/api/v1/products', {
      headers: { 'Authorization': `Bearer ${testApiKey}` },
    });
    expect(response.status()).toBe(401);

    // Restore
    await supabaseAdmin
      .from('api_keys')
      .update({ expires_at: null })
      .eq('id', testApiKeyId);
  });
});
