/**
 * v1 API Tests: Variant Groups
 *
 * Tests for /api/v1/variant-groups endpoints
 * Based on old admin-variants API test cases
 */

import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('v1 API: Variant Groups', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testProducts: any[] = [];
  let createdGroupId: string;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: adminEmail,
      password: adminPassword,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    // Create test admin user
    adminEmail = `v1-variants-admin-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    adminUserId = authData.user!.id;

    // Add to admin_users table
    const { error: adminError } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: adminUserId });

    if (adminError) throw adminError;

    // Create test products
    for (let i = 0; i < 4; i++) {
      const { data: product, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: `V1 Variant Test Product ${i + 1}`,
          slug: `v1-variant-test-${Date.now()}-${i}`,
          price: (i + 1) * 50,
          currency: 'PLN',
          description: `Test product ${i + 1} for v1 variants`,
          is_active: true,
          icon: '📦'
        })
        .select()
        .single();

      if (error) throw error;
      testProducts.push(product);
    }
  });

  test.afterAll(async () => {
    // Cleanup test products
    for (const product of testProducts) {
      await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', product.id);
    }

    // Cleanup created variant groups
    if (createdGroupId) {
      await supabaseAdmin
        .from('variant_groups')
        .delete()
        .eq('id', createdGroupId);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('POST /api/v1/variant-groups - Create Variant Group', () => {
    test('should fail without authentication', async ({ request }) => {
      const response = await request.post('/api/v1/variant-groups', {
        data: {
          products: [
            { product_id: testProducts[0].id },
            { product_id: testProducts[1].id }
          ]
        }
      });

      expect(response.status()).toBe(401);
      const json = await response.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    test('should fail with less than 2 products', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.post('/api/v1/variant-groups', {
        data: {
          products: [{ product_id: testProducts[0].id }]
        }
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error.message).toContain('At least 2 products');
    });

    test('should fail with empty products array', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.post('/api/v1/variant-groups', {
        data: {
          products: []
        }
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    test('should successfully create variant group with 2 products', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.post('/api/v1/variant-groups', {
        data: {
          name: 'V1 Test Subscription Plans',
          products: [
            { product_id: testProducts[0].id, variant_name: 'Basic Plan', is_featured: true },
            { product_id: testProducts[1].id, variant_name: 'Pro Plan' }
          ]
        }
      });

      expect(response.status()).toBe(201);
      const json = await response.json();
      expect(json.data).toBeDefined();
      expect(json.data.id).toBeDefined();
      expect(json.data.name).toBe('V1 Test Subscription Plans');
      expect(json.data.products_count).toBe(2);

      createdGroupId = json.data.id;

      // Verify in database
      const { data: group } = await supabaseAdmin
        .from('variant_groups')
        .select('id, name')
        .eq('id', json.data.id)
        .single();

      expect(group).not.toBeNull();
      expect(group!.name).toBe('V1 Test Subscription Plans');

      // Verify junction table
      const { data: pvgs } = await supabaseAdmin
        .from('product_variant_groups')
        .select('product_id, variant_name, display_order, is_featured')
        .eq('group_id', json.data.id)
        .order('display_order');

      expect(pvgs).toHaveLength(2);
      expect(pvgs![0].variant_name).toBe('Basic Plan');
      expect(pvgs![0].is_featured).toBe(true);
      expect(pvgs![0].display_order).toBe(0);
      expect(pvgs![1].variant_name).toBe('Pro Plan');
      expect(pvgs![1].display_order).toBe(1);
    });

    test('should set display_order correctly', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.post('/api/v1/variant-groups', {
        data: {
          products: [
            { product_id: testProducts[2].id, variant_name: 'First' },
            { product_id: testProducts[3].id, variant_name: 'Second' }
          ]
        }
      });

      expect(response.status()).toBe(201);
      const json = await response.json();

      // Verify display_order
      const { data: pvgs } = await supabaseAdmin
        .from('product_variant_groups')
        .select('display_order, variant_name')
        .eq('group_id', json.data.id)
        .order('display_order');

      expect(pvgs![0].display_order).toBe(0);
      expect(pvgs![0].variant_name).toBe('First');
      expect(pvgs![1].display_order).toBe(1);
      expect(pvgs![1].variant_name).toBe('Second');

      // Cleanup
      await supabaseAdmin
        .from('variant_groups')
        .delete()
        .eq('id', json.data.id);
    });

    test('should allow same product in multiple groups (M:N)', async ({ page }) => {
      await loginAsAdmin(page);

      // Create first group
      const response1 = await page.request.post('/api/v1/variant-groups', {
        data: {
          name: 'V1 Group A',
          products: [
            { product_id: testProducts[2].id, variant_name: 'In Group A' },
            { product_id: testProducts[3].id, variant_name: 'Also in A' }
          ]
        }
      });

      expect(response1.status()).toBe(201);
      const json1 = await response1.json();

      // Create second group with overlapping product
      const response2 = await page.request.post('/api/v1/variant-groups', {
        data: {
          name: 'V1 Group B',
          products: [
            { product_id: testProducts[2].id, variant_name: 'In Group B' },
            { product_id: testProducts[0].id, variant_name: 'Also in B' }
          ]
        }
      });

      expect(response2.status()).toBe(201);
      const json2 = await response2.json();

      // Verify product is in both groups
      const { data: pvgs } = await supabaseAdmin
        .from('product_variant_groups')
        .select('group_id, variant_name')
        .eq('product_id', testProducts[2].id);

      expect(pvgs).toHaveLength(2);
      expect(pvgs!.map(p => p.variant_name).sort()).toEqual(['In Group A', 'In Group B']);

      // Cleanup
      await supabaseAdmin.from('variant_groups').delete().eq('id', json1.data.id);
      await supabaseAdmin.from('variant_groups').delete().eq('id', json2.data.id);
    });
  });

  test.describe('GET /api/v1/variant-groups - List Variant Groups', () => {
    test('should fail without authentication', async ({ request }) => {
      const response = await request.get('/api/v1/variant-groups');
      expect(response.status()).toBe(401);
      const json = await response.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    test('should return all variant groups with products', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.get('/api/v1/variant-groups');

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.data).toBeDefined();
      expect(Array.isArray(json.data)).toBe(true);

      // createdGroupId must exist (set by prior test in serial suite)
      expect(createdGroupId).toBeDefined();

      const ourGroup = json.data.find((g: any) => g.id === createdGroupId);
      expect(ourGroup).toBeDefined();
      expect(ourGroup.name).toBe('V1 Test Subscription Plans');
      expect(ourGroup.products).toHaveLength(2);
    });

    test('should include product details in response', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.get('/api/v1/variant-groups');
      expect(response.status()).toBe(200);
      const json = await response.json();

      expect(json.data.length).toBeGreaterThan(0);

      const group = json.data.find((g: any) => g.products?.length > 0);
      expect(group).toBeDefined();
      expect(group.products.length).toBeGreaterThan(0);

      const product = group.products[0];
      expect(product).toHaveProperty('product_id');
      expect(product).toHaveProperty('variant_name');
      expect(product).toHaveProperty('display_order');
      expect(product).toHaveProperty('is_featured');
      expect(product).toHaveProperty('product');
      expect(product.product).toHaveProperty('name');
      expect(product.product).toHaveProperty('slug');
      expect(product.product).toHaveProperty('price');
    });
  });

  test.describe('PATCH /api/v1/variant-groups/:id - Update Variant Group', () => {
    test('should fail without authentication', async ({ request }) => {
      const response = await request.patch(`/api/v1/variant-groups/${createdGroupId}`, {
        data: { name: 'Updated Name' }
      });
      expect(response.status()).toBe(401);
    });

    test('should fail with invalid group ID', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.patch('/api/v1/variant-groups/invalid-uuid', {
        data: { name: 'Test' }
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error.message).toContain('Invalid');
    });

    test('should fail with non-existent group ID', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.patch('/api/v1/variant-groups/00000000-0000-0000-0000-000000000000', {
        data: { name: 'Test' }
      });

      expect(response.status()).toBe(404);
      const json = await response.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    test('should update group name', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.patch(`/api/v1/variant-groups/${createdGroupId}`, {
        data: { name: 'V1 Updated Subscription Plans' }
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.data).toBeDefined();

      // Verify in database
      const { data: group } = await supabaseAdmin
        .from('variant_groups')
        .select('name')
        .eq('id', createdGroupId)
        .single();

      expect(group!.name).toBe('V1 Updated Subscription Plans');
    });

    test('should update products and their order', async ({ page }) => {
      await loginAsAdmin(page);

      // Update with new order and different featured product
      const response = await page.request.patch(`/api/v1/variant-groups/${createdGroupId}`, {
        data: {
          products: [
            { product_id: testProducts[1].id, variant_name: 'Now First', display_order: 0, is_featured: true },
            { product_id: testProducts[0].id, variant_name: 'Now Second', display_order: 1, is_featured: false }
          ]
        }
      });

      expect(response.status()).toBe(200);

      // Verify order changed
      const { data: pvgs } = await supabaseAdmin
        .from('product_variant_groups')
        .select('product_id, variant_name, display_order, is_featured')
        .eq('group_id', createdGroupId)
        .order('display_order');

      expect(pvgs![0].product_id).toBe(testProducts[1].id);
      expect(pvgs![0].variant_name).toBe('Now First');
      expect(pvgs![0].is_featured).toBe(true);
      expect(pvgs![1].product_id).toBe(testProducts[0].id);
      expect(pvgs![1].variant_name).toBe('Now Second');
    });
  });

  test.describe('DELETE /api/v1/variant-groups/:id - Delete Variant Group', () => {
    let groupToDelete: string;

    test.beforeAll(async () => {
      // Create a group specifically for deletion tests
      const { data: group } = await supabaseAdmin
        .from('variant_groups')
        .insert({ name: 'V1 To Be Deleted' })
        .select('id')
        .single();

      groupToDelete = group!.id;

      // Add products to it
      await supabaseAdmin
        .from('product_variant_groups')
        .insert([
          { group_id: groupToDelete, product_id: testProducts[2].id, variant_name: 'Delete Test 1', display_order: 0 },
          { group_id: groupToDelete, product_id: testProducts[3].id, variant_name: 'Delete Test 2', display_order: 1 }
        ]);
    });

    test('should fail without authentication', async ({ request }) => {
      const response = await request.delete(`/api/v1/variant-groups/${groupToDelete}`);
      expect(response.status()).toBe(401);
    });

    test('should fail with invalid group ID', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.delete('/api/v1/variant-groups/invalid-uuid');

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error.message).toContain('Invalid');
    });

    test('should successfully delete variant group', async ({ page }) => {
      await loginAsAdmin(page);

      const response = await page.request.delete(`/api/v1/variant-groups/${groupToDelete}`);

      // v1 API returns 204 No Content on successful delete
      expect(response.status()).toBe(204);

      // Verify group is deleted
      const { data: group } = await supabaseAdmin
        .from('variant_groups')
        .select('id')
        .eq('id', groupToDelete)
        .single();

      expect(group).toBeNull();

      // Verify junction table entries are also deleted (cascade)
      const { data: pvgs } = await supabaseAdmin
        .from('product_variant_groups')
        .select('id')
        .eq('group_id', groupToDelete);

      expect(pvgs).toHaveLength(0);
    });
  });
});
