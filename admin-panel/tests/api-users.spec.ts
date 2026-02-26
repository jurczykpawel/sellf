import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Setup Admin Client directly (bypass UI login for API testing)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
// Separate client for user authentication (to avoid corrupting supabaseAdmin's service role)
const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY || '');

// Helper to login as admin via browser context
async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await page.evaluate(async ({ email, password, url, anonKey }: { email: string; password: string; url: string; anonKey: string }) => {
    // @ts-ignore
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const sb = createBrowserClient(url, anonKey);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, {
    email,
    password,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  });

  await page.reload();
}

test.describe('API /api/users', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'password123';

  test.beforeAll(async () => {
    // 1. Create a fresh admin user
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'API Admin' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // 2. Make them admin
    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: adminUserId });
  });

  test.afterAll(async () => {
    // Cleanup
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('GET /api/users should return 401 for unauthenticated requests', async ({ request }) => {
    const response = await request.get('/api/users', {
      params: {
        page: '1',
        limit: '10',
        search: '',
        sortBy: 'user_created_at',
        sortOrder: 'desc'
      }
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  test('GET /api/users should return 200 and paginated user list for admin', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.request.get('/api/users?page=1&limit=10&search=&sortBy=user_created_at&sortOrder=desc');

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Verify response structure
    expect(body.users).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.pagination).toHaveProperty('total');
    expect(body.pagination).toHaveProperty('totalPages');
    expect(body.pagination).toHaveProperty('currentPage');
    expect(body.pagination.currentPage).toBe(1);

    // We created at least one user (the admin), so users array must not be empty
    expect(body.users.length).toBeGreaterThan(0);

    // Verify user structure
    const firstUser = body.users[0];
    expect(firstUser).toHaveProperty('email');
    expect(firstUser).toHaveProperty('id');
    expect(firstUser).toHaveProperty('stats');
    expect(firstUser.stats).toHaveProperty('total_products');
  });

  test('GET /api/users should support sorting by email ascending', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.request.get('/api/users?page=1&limit=10&search=&sortBy=email&sortOrder=asc');

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.users).toBeInstanceOf(Array);
    expect(body.users.length).toBeGreaterThan(0);
  });

  test('GET /api/users should support search by email', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    // Search for the admin user we created
    const response = await page.request.get(`/api/users?page=1&limit=10&search=api-test&sortBy=user_created_at&sortOrder=desc`);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.users).toBeInstanceOf(Array);
    expect(body.users.length).toBeGreaterThan(0);

    // All returned users should match the search term
    for (const user of body.users) {
      expect(user.email.toLowerCase()).toContain('api-test');
    }
  });

  test('GET /api/users should return empty results for non-matching search', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.request.get('/api/users?page=1&limit=10&search=zzz-nonexistent-email-zzz&sortBy=user_created_at&sortOrder=desc');

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.users).toBeInstanceOf(Array);
    expect(body.users.length).toBe(0);
    expect(body.pagination.total).toBe(0);
  });

  test('POST /api/users should return 401 for unauthenticated requests', async ({ request }) => {
    const response = await request.post('/api/users', {
      data: {
        userId: '00000000-0000-0000-0000-000000000000',
        productId: '00000000-0000-0000-0000-000000000000',
        action: 'grant'
      }
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  test('POST /api/users should return 400 for invalid action', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.request.post('/api/users', {
      data: {
        userId: adminUserId,
        productId: '00000000-0000-0000-0000-000000000000',
        action: 'invalid-action'
      }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });
});
