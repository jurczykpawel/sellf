/**
 * Tests for API Keys Management v1
 *
 * Tests API key CRUD, rotation, scopes, and authentication.
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

// Helper to login as admin via browser context
async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await setAuthSession(page, email, password);

  await page.reload();
}

test.describe('API Keys v1', () => {
  let adminUserId: string;
  let adminId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  const createdKeyIds: string[] = [];

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `api-keys-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'API Keys Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    const { data: admin } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: adminUserId })
      .select('id')
      .single();

    adminId = admin!.id;
  });

  test.afterAll(async () => {
    // Cleanup created API keys
    for (const keyId of createdKeyIds) {
      await supabaseAdmin.from('api_key_audit_log').delete().eq('api_key_id', keyId);
      await supabaseAdmin.from('api_keys').delete().eq('id', keyId);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/v1/api-keys');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('POST /api/v1/api-keys', () => {
    test('should create an API key with required fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Test Key'
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('key');
      expect(body.data.name).toBe('Test Key');
      expect(body.data.key).toMatch(/^sf_live_/);
      expect(body.data.scopes).toContain('*');
      expect(body.data).toHaveProperty('warning');

      createdKeyIds.push(body.data.id);
    });

    test('should create an API key with custom scopes', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Limited Key',
          scopes: ['products:read', 'users:read']
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.scopes).toContain('products:read');
      expect(body.data.scopes).toContain('users:read');
      expect(body.data.scopes).not.toContain('*');

      createdKeyIds.push(body.data.id);
    });

    test('should create an API key with expiration', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const response = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Expiring Key',
          expires_at: expiresAt
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(typeof body.data.expires_at).toBe('string');
      expect(new Date(body.data.expires_at).getTime()).toBeGreaterThan(Date.now());

      createdKeyIds.push(body.data.id);
    });

    test('should return validation error for missing name', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/api-keys', {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return validation error for invalid scopes', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Invalid Scopes Key',
          scopes: ['invalid:scope', 'another:invalid']
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  test.describe('GET /api/v1/api-keys', () => {
    test('should list API keys', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/api-keys');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      // Should NOT contain the key secrets
      for (const key of body.data) {
        expect(key).not.toHaveProperty('key');
        expect(key).not.toHaveProperty('key_hash');
        expect(key).toHaveProperty('key_prefix');
      }
    });
  });

  test.describe('GET /api/v1/api-keys/:id', () => {
    test('should return key details', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // First create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Get Details Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      // Then get its details
      const response = await page.request.get(`/api/v1/api-keys/${createBody.data.id}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.id).toBe(createBody.data.id);
      expect(body.data.name).toBe('Get Details Key');
      expect(body.data).not.toHaveProperty('key');
    });

    test('should return 404 for non-existent key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Use a properly formatted UUID that doesn't exist
      const nonExistentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const response = await page.request.get(`/api/v1/api-keys/${nonExistentId}`);

      expect(response.status()).toBe(404);
    });
  });

  test.describe('PATCH /api/v1/api-keys/:id', () => {
    test('should update key name', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Original Name' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      // Update it
      const response = await page.request.patch(`/api/v1/api-keys/${createBody.data.id}`, {
        data: { name: 'Updated Name' }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.name).toBe('Updated Name');
    });

    test('should silently ignore scopes — DB scopes unchanged even when sent with valid field', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Scope Immutability Key' }
      });
      const { data: key } = await createResponse.json();
      createdKeyIds.push(key.id);

      // scopes + valid field → 200, name updated, scopes ignored
      const response = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { name: 'Scope Immutability Key Renamed', scopes: ['products:read'] }
      });

      expect(response.status()).toBe(200);

      // Scopes must be unchanged in DB
      const { data: dbKey } = await supabaseAdmin
        .from('api_keys')
        .select('scopes')
        .eq('id', key.id)
        .single();
      expect(dbKey?.scopes).toContain('*');
    });

    test('should silently ignore rate_limit_per_minute — DB rate_limit unchanged even when sent with valid field', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Rate Limit Immutability Key', rate_limit_per_minute: 60 }
      });
      const { data: key } = await createResponse.json();
      createdKeyIds.push(key.id);

      // rate_limit + valid field → 200, name updated, rate_limit ignored
      const response = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { name: 'Rate Limit Key Renamed', rate_limit_per_minute: 999 }
      });

      expect(response.status()).toBe(200);

      // Rate limit must be unchanged in DB
      const { data: dbKey } = await supabaseAdmin
        .from('api_keys')
        .select('rate_limit_per_minute')
        .eq('id', key.id)
        .single();
      expect(dbKey?.rate_limit_per_minute).toBe(60);
    });

    test('should deactivate key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Deactivate Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      // Deactivate it
      const response = await page.request.patch(`/api/v1/api-keys/${createBody.data.id}`, {
        data: { is_active: false }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.is_active).toBe(false);
    });

    test('should reject patch on revoked key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Revoke Before Patch' }
      });
      const { data: key } = await createResponse.json();
      createdKeyIds.push(key.id);

      await page.request.delete(`/api/v1/api-keys/${key.id}`);

      const response = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { name: 'Should Not Work' }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 when only unknown fields sent (key_hash, expires_at)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Immutable Fields Test' }
      });
      const { data: key } = await createResponse.json();
      createdKeyIds.push(key.id);

      // key_hash alone — must not be accepted as a valid update field
      const hashResponse = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { key_hash: 'hacked_hash' }
      });
      expect(hashResponse.status()).toBe(400);

      // expires_at alone — not an editable field via PATCH
      const expiresResponse = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { expires_at: new Date(Date.now() + 86400000).toISOString() }
      });
      expect(expiresResponse.status()).toBe(400);
    });

    test('should silently ignore key_hash — valid fields still update, DB hash unchanged', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Mixed Fields Key' }
      });
      const { data: key, key: rawKey } = await createResponse.json();
      createdKeyIds.push(key.id);

      // Capture the real hash from DB before the attempt
      const { data: before } = await supabaseAdmin
        .from('api_keys')
        .select('key_hash')
        .eq('id', key.id)
        .single();
      expect(before?.key_hash).toBeTruthy();

      // key_hash is unknown to the endpoint — silently dropped, name still updates
      const response = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { name: 'Mixed Fields Key Updated', key_hash: 'tampered' }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.name).toBe('Mixed Fields Key Updated');

      // Verify DB hash is unchanged — the tampered value was never written
      const { data: after } = await supabaseAdmin
        .from('api_keys')
        .select('key_hash')
        .eq('id', key.id)
        .single();
      expect(after?.key_hash).toBe(before?.key_hash);

      // Original key still authenticates
      if (rawKey) {
        const verifyResponse = await page.request.get('/api/v1/api-keys', {
          headers: { Authorization: `Bearer ${rawKey}` }
        });
        expect(verifyResponse.status()).not.toBe(401);
      }
    });

    test('should reject empty name', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Empty Name Test' }
      });
      const { data: key } = await createResponse.json();
      createdKeyIds.push(key.id);

      const response = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { name: '' }
      });

      expect(response.status()).toBe(400);
    });

    test('should return 400 when only unknown/immutable fields sent (no valid update fields)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'No Valid Fields Test' }
      });
      const { data: key } = await createResponse.json();
      createdKeyIds.push(key.id);

      // scopes alone — not an editable field
      const scopesResponse = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { scopes: ['products:read'] }
      });
      expect(scopesResponse.status()).toBe(400);

      // rate_limit alone — not an editable field
      const rateLimitResponse = await page.request.patch(`/api/v1/api-keys/${key.id}`, {
        data: { rate_limit_per_minute: 200 }
      });
      expect(rateLimitResponse.status()).toBe(400);
    });
  });

  test.describe('DELETE /api/v1/api-keys/:id', () => {
    test('should revoke key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Revoke Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      // Revoke it
      const response = await page.request.delete(`/api/v1/api-keys/${createBody.data.id}?reason=Testing`);

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.revoked).toBe(true);
    });

    test('should not allow revoking already revoked key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create and revoke a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Double Revoke Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      await page.request.delete(`/api/v1/api-keys/${createBody.data.id}`);

      // Try to revoke again
      const response = await page.request.delete(`/api/v1/api-keys/${createBody.data.id}`);

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  test.describe('POST /api/v1/api-keys/:id/rotate', () => {
    test('should rotate key with grace period', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Rotate Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      // Rotate it
      const response = await page.request.post(`/api/v1/api-keys/${createBody.data.id}/rotate`, {
        data: { grace_period_hours: 24 }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data).toHaveProperty('new_key');
      expect(body.data).toHaveProperty('old_key');
      expect(body.data.new_key.key).toMatch(/^sf_live_/);
      expect(typeof body.data.old_key.grace_until).toBe('string');
      expect(new Date(body.data.old_key.grace_until).getTime()).toBeGreaterThan(Date.now());

      createdKeyIds.push(body.data.new_key.id);
    });

    test('should rotate key without grace period', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Immediate Rotate Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      // Rotate without grace period
      const response = await page.request.post(`/api/v1/api-keys/${createBody.data.id}/rotate`, {
        data: { grace_period_hours: 0 }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.old_key.grace_until).toBeNull();

      createdKeyIds.push(body.data.new_key.id);
    });

    test('should not rotate revoked key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create and revoke a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Revoked Rotate Key' }
      });
      const createBody = await createResponse.json();
      createdKeyIds.push(createBody.data.id);

      await page.request.delete(`/api/v1/api-keys/${createBody.data.id}`);

      // Try to rotate
      const response = await page.request.post(`/api/v1/api-keys/${createBody.data.id}/rotate`);

      expect(response.status()).toBe(400);
    });
  });

  test.describe('API Key Authentication', () => {
    let testApiKey: string;

    test('should authenticate with valid API key', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a real API key via API
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Real Auth Test Key' }
      });
      const createBody = await createResponse.json();
      testApiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Use fresh request context (no session) to test API key auth
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${testApiKey}`
        }
      });

      expect(response.status()).toBe(200);
    });

    test('should reject invalid API key', async ({ request }) => {
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': 'Bearer sf_live_invalidkey123456789'
        }
      });

      expect(response.status()).toBe(401);
    });

    test('should reject expired API key', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key that expires in the past (we'll update it in DB)
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Expired Key',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Update to expired
      await supabaseAdmin
        .from('api_keys')
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq('id', createBody.data.id);

      // Try to use the expired key
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      expect(response.status()).toBe(401);
    });

    test('should reject deactivated API key', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Deactivated Key Test' }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Deactivate it
      await page.request.patch(`/api/v1/api-keys/${createBody.data.id}`, {
        data: { is_active: false }
      });

      // Try to use the deactivated key
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      expect(response.status()).toBe(401);
    });

    test('should reject revoked API key', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Revoked Key Auth Test' }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Revoke it
      await page.request.delete(`/api/v1/api-keys/${createBody.data.id}?reason=Testing`);

      // Try to use the revoked key
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_TOKEN');
    });

    test('should accept old key during rotation grace period', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Grace Period Test Key' }
      });
      const createBody = await createResponse.json();
      const oldApiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Rotate with 24h grace period
      const rotateResponse = await page.request.post(`/api/v1/api-keys/${createBody.data.id}/rotate`, {
        data: { grace_period_hours: 24 }
      });
      const rotateBody = await rotateResponse.json();
      const newApiKey = rotateBody.data.new_key.key;
      createdKeyIds.push(rotateBody.data.new_key.id);

      // OLD key should still work during grace period
      const oldKeyResponse = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${oldApiKey}`
        }
      });
      expect(oldKeyResponse.status()).toBe(200);

      // NEW key should also work
      const newKeyResponse = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${newApiKey}`
        }
      });
      expect(newKeyResponse.status()).toBe(200);
    });

    test('should reject old key after rotation grace period expires', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'Expired Grace Period Key' }
      });
      const createBody = await createResponse.json();
      const oldApiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Rotate with grace period
      const rotateResponse = await page.request.post(`/api/v1/api-keys/${createBody.data.id}/rotate`, {
        data: { grace_period_hours: 24 }
      });
      const rotateBody = await rotateResponse.json();
      createdKeyIds.push(rotateBody.data.new_key.id);

      // Manually expire the grace period in DB
      await supabaseAdmin
        .from('api_keys')
        .update({ rotation_grace_until: new Date(Date.now() - 1000).toISOString() })
        .eq('id', createBody.data.id);

      // OLD key should now be rejected
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${oldApiKey}`
        }
      });

      expect(response.status()).toBe(401);
    });

    test('should reject old key immediately when rotated without grace period', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: { name: 'No Grace Period Key' }
      });
      const createBody = await createResponse.json();
      const oldApiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Rotate WITHOUT grace period
      const rotateResponse = await page.request.post(`/api/v1/api-keys/${createBody.data.id}/rotate`, {
        data: { grace_period_hours: 0 }
      });
      const rotateBody = await rotateResponse.json();
      createdKeyIds.push(rotateBody.data.new_key.id);

      // OLD key should be immediately rejected
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${oldApiKey}`
        }
      });

      expect(response.status()).toBe(401);
    });
  });

  test.describe('Scope Enforcement', () => {
    test('should allow access with correct scope', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with products:read scope
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Products Read Key',
          scopes: ['products:read']
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Use fresh request context to test API key auth
      // Should be able to read products
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      expect(response.status()).toBe(200);
    });

    test('should deny access without required scope', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with only products:read scope
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Products Read Only Key',
          scopes: ['products:read']
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Use fresh request context (without session cookies) to test API key auth
      // Should NOT be able to create products (requires products:write)
      const response = await request.post('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        data: {
          name: 'Test Product',
          slug: 'test-product-scope',
          description: 'Test',
          price: 100
        }
      });

      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    test('should allow write scope for read operations', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with products:write scope (which should imply products:read)
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Products Write Key',
          scopes: ['products:write']
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Use fresh request context to test API key auth
      // Should be able to read products (write implies read)
      const response = await request.get('/api/v1/products', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      expect(response.status()).toBe(200);
    });

    test('should allow full access with wildcard scope', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with full access
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Full Access Key',
          scopes: ['*']
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Use fresh request context to test API key auth
      // Should be able to do everything
      const readResponse = await request.get('/api/v1/products', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      expect(readResponse.status()).toBe(200);

      const usersResponse = await request.get('/api/v1/users', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      expect(usersResponse.status()).toBe(200);
    });

    test('should deny cross-category access (users:read cannot access products)', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with ONLY users:read scope
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Users Only Key',
          scopes: ['users:read']
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Should be able to access users
      const usersResponse = await request.get('/api/v1/users', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      expect(usersResponse.status()).toBe(200);

      // Should NOT be able to access products (different category)
      const productsResponse = await request.get('/api/v1/products', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      expect(productsResponse.status()).toBe(403);
      const body = await productsResponse.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    test('should allow write scope for read in other categories (users:write implies users:read)', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with users:write scope
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Users Write Key',
          scopes: ['users:write']
        }
      });
      const createBody = await createResponse.json();
      const apiKey = createBody.data.key;
      createdKeyIds.push(createBody.data.id);

      // Should be able to read users (write implies read)
      const usersResponse = await request.get('/api/v1/users', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      expect(usersResponse.status()).toBe(200);
    });

    test('should deny access with empty scopes array', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a key with empty scopes (API should default to * or reject)
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Empty Scopes Key',
          scopes: []
        }
      });
      const createBody = await createResponse.json();

      // API should either reject empty scopes (400) or create with defaults (201)
      const status = createResponse.status();
      expect([201, 400]).toContain(status);

      if (status === 201) {
        expect(createBody.data?.key).toBeDefined();
        const apiKey = createBody.data.key;
        createdKeyIds.push(createBody.data.id);

        // Check what scopes were actually assigned
        const keyDetails = await page.request.get(`/api/v1/api-keys/${createBody.data.id}`);
        const detailsBody = await keyDetails.json();

        if (detailsBody.data.scopes.length === 0) {
          // Empty scopes stored — access should be denied
          const response = await request.get('/api/v1/products', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          expect(response.status()).toBe(403);
        } else {
          // API defaulted to some scopes (likely *)
          expect(detailsBody.data.scopes.length).toBeGreaterThan(0);
        }
      } else {
        // API rejected empty scopes — verify error format
        expect(createBody.error).toBeDefined();
        expect(createBody.error.code).toBeDefined();
      }
    });
  });

  test.describe('Response Format', () => {
    test('should use standardized success response format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/api-keys');
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body).not.toHaveProperty('error');
    });

    test('should use standardized error response format', async ({ request }) => {
      const response = await request.get('/api/v1/api-keys');
      const body = await response.json();

      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(body).not.toHaveProperty('data');
    });
  });
});
