/**
 * API Integration Test Setup
 *
 * These tests run against a live server (dev or test).
 * Before running: npm run dev (in another terminal)
 *
 * Environment variables:
 * - TEST_API_URL: Base URL (default: http://localhost:3777)
 * - TEST_API_KEY: API key for authentication (created in beforeAll)
 */

import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

// Test configuration
export const API_URL = process.env.TEST_API_URL || 'http://localhost:3777';

// Supabase client for test setup (using service role for admin operations)
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Test API key storage
let testApiKey: string | null = null;
let testApiKeyId: string | null = null;
let testAdminUserId: string | null = null;

/**
 * Generate API key (matching @/lib/api/api-keys.ts format)
 */
function generateApiKey() {
  const prefix = 'sf_test_';
  const randomPart = randomBytes(32).toString('hex');
  const plaintext = `${prefix}${randomPart}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');

  return {
    plaintext,
    prefix: plaintext.substring(0, 12),
    hash,
  };
}

// Store both the auth user ID and the admin_users.id separately
let testAuthUserId: string | null = null;

/**
 * Get or create a test admin user
 * Returns the admin_users.id (not auth.users.id)
 */
async function getTestAdminUser(): Promise<string> {
  if (testAdminUserId) return testAdminUserId;

  // Retry up to 3× because supabase.auth.admin.createUser occasionally
  // returns "Database error creating new user" under load — almost always
  // a transient GoTrue/Postgres race that succeeds on the next attempt.
  let userData: Awaited<ReturnType<typeof supabase.auth.admin.createUser>>['data'] | null = null;
  let lastErr: { message: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const testEmail = `vitest-api-admin-${Date.now()}-${attempt}@example.com`;
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (!error && data?.user) {
      userData = data;
      break;
    }
    lastErr = error ?? { message: 'unknown' };
    await new Promise((r) => setTimeout(r, 150 * attempt));
  }
  if (!userData) {
    throw new Error(`Failed to create test admin user after 3 attempts: ${lastErr?.message}`);
  }

  testAuthUserId = userData.user!.id;

  // Make user an admin and get the admin_users.id
  const { data: adminData, error: adminError } = await supabase
    .from('admin_users')
    .insert({ user_id: testAuthUserId })
    .select('id')
    .single();

  if (adminError) {
    // Maybe it already exists - try to fetch it
    if (adminError.code === '23505') {
      const { data: existing } = await supabase
        .from('admin_users')
        .select('id')
        .eq('user_id', testAuthUserId)
        .single();

      if (existing) {
        testAdminUserId = existing.id;
        return existing.id;
      }
    }
    throw new Error(`Failed to make user admin: ${adminError.message}`);
  }

  testAdminUserId = adminData.id;
  return adminData.id;
}

/**
 * Create a test API key with full access
 */
export async function createTestApiKey(): Promise<string> {
  if (testApiKey) return testApiKey;

  // Ensure we have an admin user
  const adminUserId = await getTestAdminUser();

  // Generate the API key
  const keyData = generateApiKey();

  // Insert into database
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      name: `vitest-key-${Date.now()}`,
      key_prefix: keyData.prefix,
      key_hash: keyData.hash,
      admin_user_id: adminUserId,
      scopes: ['*'],
      rate_limit_per_minute: 1000,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create test API key: ${error.message}`);
  }

  testApiKey = keyData.plaintext;
  testApiKeyId = data.id;
  return testApiKey;
}

/**
 * No-op during tests. The real cleanup happens once in globalTeardown
 * (tests/api/global-setup.ts) — running it per-file caused races: file N's
 * afterAll cleared the module-level testApiKey cache and deleted the auth
 * user, then file N+1's beforeAll raced supabase.auth.admin.createUser and
 * occasionally hit "Database error creating new user", surfacing as a flaky
 * 401 on the first API call.
 *
 * Kept as an exported function so the existing call sites in test files
 * still compile without churn.
 */
export async function deleteTestApiKey(): Promise<void> {
  // intentional no-op — see _globalCleanupTestApiKey
}

/**
 * Globally tear down the shared admin user, admin_users row, and API key.
 * Called once by tests/api/global-setup.ts after the whole suite finishes.
 */
export async function _globalCleanupTestApiKey(): Promise<void> {
  if (testApiKeyId) {
    await supabase.from('api_keys').delete().eq('id', testApiKeyId);
    testApiKey = null;
    testApiKeyId = null;
  }
  if (testAdminUserId) {
    await supabase.from('admin_users').delete().eq('id', testAdminUserId);
    testAdminUserId = null;
  }
  if (testAuthUserId) {
    // audit_log.user_id has a FK to auth.users with no cascade, so a raw
    // deleteUser would fail silently and leak the row. Clear the audit
    // trail for this test user first.
    await supabase.from('audit_log').delete().eq('user_id', testAuthUserId);
    await supabase.auth.admin.deleteUser(testAuthUserId);
    testAuthUserId = null;
  }
}

/**
 * Make authenticated API request
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; data: T; headers: Headers }> {
  const apiKey = await createTestApiKey();

  const url = `${API_URL}${path}`;
  const headers = new Headers(options.headers);
  headers.set('X-API-Key', apiKey);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  return {
    status: response.status,
    data: data as T,
    headers: response.headers,
  };
}

/**
 * GET request helper
 */
export function get<T = unknown>(path: string) {
  return apiRequest<T>(path, { method: 'GET' });
}

/**
 * POST request helper
 */
export function post<T = unknown>(path: string, body: unknown) {
  return apiRequest<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * PATCH request helper
 */
export function patch<T = unknown>(path: string, body: unknown) {
  return apiRequest<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * PUT request helper
 */
export function put<T = unknown>(path: string, body: unknown) {
  return apiRequest<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE request helper
 */
export function del<T = unknown>(path: string) {
  return apiRequest<T>(path, { method: 'DELETE' });
}

/**
 * Test data factory
 */
export const testData = {
  product: (overrides = {}) => ({
    name: `Test Product ${Date.now()}`,
    slug: `test-product-${Date.now()}`,
    price: 99.99,
    currency: 'PLN',
    description: 'Test product description',
    is_active: true,
    ...overrides,
  }),

  coupon: (overrides = {}) => ({
    code: `TEST${Date.now()}`,
    discount_type: 'percentage' as const,
    discount_value: 10,
    is_active: true,
    ...overrides,
  }),

  webhook: (overrides = {}) => ({
    url: 'https://webhook.site/test-endpoint',
    events: ['payment.completed'],
    is_active: true,
    ...overrides,
  }),
};

/**
 * Cleanup helper - delete created resources
 */
export async function cleanup(resources: {
  products?: string[];
  coupons?: string[];
  webhooks?: string[];
  payments?: string[];
  userAccess?: Array<{ userId: string; accessId: string }>;
}) {
  const promises: Promise<unknown>[] = [];

  if (resources.products?.length) {
    resources.products.forEach((id) => {
      promises.push(del(`/api/v1/products/${id}`));
    });
  }

  if (resources.coupons?.length) {
    resources.coupons.forEach((id) => {
      promises.push(del(`/api/v1/coupons/${id}`));
    });
  }

  if (resources.webhooks?.length) {
    resources.webhooks.forEach((id) => {
      promises.push(del(`/api/v1/webhooks/${id}`));
    });
  }

  if (resources.userAccess?.length) {
    resources.userAccess.forEach(({ userId, accessId }) => {
      promises.push(del(`/api/v1/users/${userId}/access/${accessId}`));
    });
  }

  await Promise.allSettled(promises);
}

/**
 * Direct Supabase access for test setup (service role operations)
 */
export { supabase };
