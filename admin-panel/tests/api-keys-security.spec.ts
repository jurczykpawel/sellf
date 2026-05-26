/**
 * API Keys Security Tests
 *
 * Verifies that API key management endpoints CANNOT be accessed using API key authentication.
 * This is a critical security measure - API keys should only be manageable via admin session.
 *
 * Rationale: If API keys could manage themselves, a compromised key could:
 * - Escalate its own privileges (add scopes)
 * - Create new keys with higher permissions
 * - Revoke other keys (DoS attack)
 * - Hide audit trail by modifying keys
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { ALL_SCOPES } from '@/lib/api/scope-constants';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('API Keys Security - Self-Management Prevention', () => {
  let testApiKey: string;
  let testApiKeyId: string;
  let testAuthUserId: string; // auth.users.id
  let testAdminRowId: string; // admin_users.id (different!)

  test.beforeAll(async () => {
    // Create a test admin user first
    const adminEmail = `security-test-admin-${Date.now()}@test.com`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (authError) throw authError;
    testAuthUserId = authData.user.id;

    // Make user admin and get the admin_users row ID
    const { data: adminRow, error: adminInsertError } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: testAuthUserId })
      .select('id')
      .single();
    if (adminInsertError) throw adminInsertError;
    testAdminRowId = adminRow.id;

    // Create a test API key with full access
    // Key format must be sf_live_ or sf_test_ + 64 hex characters
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const keyValue = `sf_live_${randomHex}`;
    const keyHash = await hashKey(keyValue);

    const { data: key, error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        name: 'Security Test Key - Full Access',
        key_hash: keyHash,
        key_prefix: keyValue.substring(0, 12),
        scopes: [...ALL_SCOPES], // Full access (explicit snapshot — '*' is never persisted)
        is_active: true,
        rate_limit_per_minute: 100,
        admin_user_id: testAdminRowId, // admin_users.id, NOT auth.users.id
      })
      .select('id')
      .single();

    if (error) throw error;
    testApiKeyId = key.id;
    testApiKey = keyValue;
  });

  test.afterAll(async () => {
    // Cleanup
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

  test('should NOT allow listing API keys via API key auth', async ({ request }) => {
    const response = await request.get('/api/v1/api-keys', {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
      },
    });

    // Must be 401 - API key auth should not work for this endpoint
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  test('should NOT allow creating API keys via API key auth', async ({ request }) => {
    const response = await request.post('/api/v1/api-keys', {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Malicious Key',
        scopes: ['*'],
      },
    });

    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  test('should NOT allow reading single API key via API key auth', async ({ request }) => {
    const response = await request.get(`/api/v1/api-keys/${testApiKeyId}`, {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should NOT allow updating API keys via API key auth', async ({ request }) => {
    const response = await request.patch(`/api/v1/api-keys/${testApiKeyId}`, {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        scopes: ['*'], // Attempting to escalate privileges
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should NOT allow rotating API keys via API key auth', async ({ request }) => {
    const response = await request.post(`/api/v1/api-keys/${testApiKeyId}/rotate`, {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        grace_period_hours: 24,
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should NOT allow revoking API keys via API key auth', async ({ request }) => {
    const response = await request.delete(`/api/v1/api-keys/${testApiKeyId}`, {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should NOT allow X-API-Key header for api-keys management', async ({ request }) => {
    // Test with X-API-Key header instead of Bearer
    const response = await request.get('/api/v1/api-keys', {
      headers: {
        'X-API-Key': testApiKey,
      },
    });

    expect(response.status()).toBe(401);
  });

  test('even with full access scope (*), API key cannot manage keys', async ({ request }) => {
    // This test explicitly verifies that scope='*' does NOT grant api-keys access
    // The endpoint should require admin session, not just any valid API key

    const response = await request.get('/api/v1/api-keys', {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
      },
    });

    expect(response.status()).toBe(401);

    // Verify the key itself is valid by testing another endpoint
    const productsResponse = await request.get('/api/v1/products', {
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
      },
    });

    // Products should work (proves key is valid)
    expect(productsResponse.status()).toBe(200);
  });
});

// Helper to hash API key (same as in the application)
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
