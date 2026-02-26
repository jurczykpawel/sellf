/**
 * Tests for Products API v1
 *
 * Tests cursor-based pagination, CRUD operations, and error handling.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to create unique slug
const uniqueSlug = () => `test-product-${Date.now()}-${Math.random().toString(36).substring(7)}`;

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

test.describe('Products API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  const testProducts: string[] = [];

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `api-v1-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'API v1 Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });
  });

  test.afterAll(async () => {
    // Cleanup test products
    for (const productId of testProducts) {
      await supabaseAdmin.from('product_categories').delete().eq('product_id', productId);
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/v1/products');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/products', () => {
    test('should return products list with pagination', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/products');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toHaveProperty('cursor');
      expect(body.pagination).toHaveProperty('next_cursor');
      expect(body.pagination).toHaveProperty('has_more');
      expect(body.pagination).toHaveProperty('limit');
    });

    test('should respect limit parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/products?limit=5');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.pagination.limit).toBe(5);
      expect(body.data.length).toBeLessThanOrEqual(5);
    });

    test('should filter by status', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/products?status=active');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // All returned products should be active
      expect(body.data.length).toBeGreaterThan(0);
      for (const product of body.data) {
        expect(product.is_active).toBe(true);
      }
    });

    test('should support search parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // First create a product with unique name
      const uniqueName = `SearchTest-${Date.now()}`;
      const createResponse = await page.request.post('/api/v1/products', {
        data: {
          name: uniqueName,
          slug: uniqueSlug(),
          description: 'Search test product',
          price: 10.00
        }
      });

      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json();
      testProducts.push(created.data.id);

      // Search for it
      const searchResponse = await page.request.get(`/api/v1/products?search=${uniqueName}`);

      expect(searchResponse.status()).toBe(200);
      const body = await searchResponse.json();

      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.some((p: any) => p.name === uniqueName)).toBe(true);
    });

    test('should support cursor pagination', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a few products to ensure pagination works
      const products = [];
      for (let i = 0; i < 3; i++) {
        const createResponse = await page.request.post('/api/v1/products', {
          data: {
            name: `Pagination Test ${i}`,
            slug: uniqueSlug(),
            description: 'Pagination test product',
            price: 10.00
          }
        });
        const created = await createResponse.json();
        products.push(created.data.id);
        testProducts.push(created.data.id);
      }

      // Get first page with limit=1
      const firstPage = await page.request.get('/api/v1/products?limit=1');
      expect(firstPage.status()).toBe(200);
      const firstBody = await firstPage.json();

      // We created 3 products above with limit=1, so there must be more pages
      expect(firstBody.pagination.has_more).toBe(true);
      expect(firstBody.pagination.next_cursor).toBeTruthy();

      // Get second page
      const secondPage = await page.request.get(`/api/v1/products?limit=1&cursor=${firstBody.pagination.next_cursor}`);
      expect(secondPage.status()).toBe(200);
      const secondBody = await secondPage.json();

      // Products should be different
      expect(secondBody.data.length).toBeGreaterThan(0);
      expect(secondBody.data[0].id).not.toBe(firstBody.data[0].id);
    });
  });

  test.describe('POST /api/v1/products', () => {
    test('should create a product with required fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const slug = uniqueSlug();
      const response = await page.request.post('/api/v1/products', {
        data: {
          name: 'Test Product',
          slug: slug,
          description: 'A test product description',
          price: 29.99
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data).toHaveProperty('id');
      expect(body.data.name).toBe('Test Product');
      expect(body.data.slug).toBe(slug);
      expect(body.data.price).toBeCloseTo(29.99, 2);
      expect(body.data.currency).toBe('USD'); // default
      expect(body.data.is_active).toBe(true); // default

      testProducts.push(body.data.id);
    });

    test('should return validation error for missing required fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/products', {
        data: {
          name: 'Test Product'
          // missing slug, description, price
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();

      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return error for duplicate slug', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const slug = uniqueSlug();

      // Create first product
      const first = await page.request.post('/api/v1/products', {
        data: {
          name: 'First Product',
          slug: slug,
          description: 'First product',
          price: 10.00
        }
      });
      expect(first.status()).toBe(201);
      const firstBody = await first.json();
      testProducts.push(firstBody.data.id);

      // Try to create second with same slug
      const second = await page.request.post('/api/v1/products', {
        data: {
          name: 'Second Product',
          slug: slug,
          description: 'Second product',
          price: 20.00
        }
      });

      expect(second.status()).toBe(409);
      const body = await second.json();
      expect(body.error.code).toBe('ALREADY_EXISTS');
    });

    test('should validate slug format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/products', {
        data: {
          name: 'Test Product',
          slug: 'Invalid Slug With Spaces!',
          description: 'Test description',
          price: 10.00
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  test.describe('GET /api/v1/products/:id', () => {
    test('should return a product by ID', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a product first
      const createResponse = await page.request.post('/api/v1/products', {
        data: {
          name: 'Get By ID Test',
          slug: uniqueSlug(),
          description: 'Test product',
          price: 15.00
        }
      });
      const created = await createResponse.json();
      testProducts.push(created.data.id);

      // Get by ID
      const getResponse = await page.request.get(`/api/v1/products/${created.data.id}`);

      expect(getResponse.status()).toBe(200);
      const body = await getResponse.json();

      expect(body.data.id).toBe(created.data.id);
      expect(body.data.name).toBe('Get By ID Test');
    });

    test('should return 404 for non-existent product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Valid UUID format but doesn't exist
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.get(`/api/v1/products/${fakeId}`);

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/products/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('PATCH /api/v1/products/:id', () => {
    test('should update product fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a product
      const createResponse = await page.request.post('/api/v1/products', {
        data: {
          name: 'Update Test',
          slug: uniqueSlug(),
          description: 'Original description',
          price: 10.00
        }
      });
      const created = await createResponse.json();
      testProducts.push(created.data.id);

      // Update it
      const updateResponse = await page.request.patch(`/api/v1/products/${created.data.id}`, {
        data: {
          name: 'Updated Name',
          price: 25.00
        }
      });

      expect(updateResponse.status()).toBe(200);
      const body = await updateResponse.json();

      expect(body.data.name).toBe('Updated Name');
      expect(body.data.price).toBeCloseTo(25.00, 2);
      expect(body.data.description).toBe('Original description'); // unchanged
    });

    test('should return 404 for non-existent product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Valid UUID format but doesn't exist
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.patch(`/api/v1/products/${fakeId}`, {
        data: { name: 'New Name' }
      });

      expect(response.status()).toBe(404);
    });

    test('should prevent duplicate slug on update', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const slug1 = uniqueSlug();
      const slug2 = uniqueSlug();

      // Create two products and verify they were created successfully
      const first = await page.request.post('/api/v1/products', {
        data: { name: 'First', slug: slug1, description: 'First', price: 10.00 }
      });
      expect(first.status()).toBe(201);
      const firstBody = await first.json();
      expect(firstBody.data?.id).toBeDefined();
      testProducts.push(firstBody.data.id);

      const second = await page.request.post('/api/v1/products', {
        data: { name: 'Second', slug: slug2, description: 'Second', price: 20.00 }
      });
      expect(second.status()).toBe(201);
      const secondBody = await second.json();
      expect(secondBody.data?.id).toBeDefined();
      testProducts.push(secondBody.data.id);

      // Try to update second to have first's slug
      const updateResponse = await page.request.patch(`/api/v1/products/${secondBody.data.id}`, {
        data: { slug: slug1 }
      });

      expect(updateResponse.status()).toBe(409);
      const body = await updateResponse.json();
      expect(body.error.code).toBe('ALREADY_EXISTS');
    });
  });

  test.describe('DELETE /api/v1/products/:id', () => {
    test('should delete a product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a product
      const createResponse = await page.request.post('/api/v1/products', {
        data: {
          name: 'Delete Test',
          slug: uniqueSlug(),
          description: 'Will be deleted',
          price: 10.00
        }
      });
      const created = await createResponse.json();
      const productId = created.data.id;

      // Delete it
      const deleteResponse = await page.request.delete(`/api/v1/products/${productId}`);

      // DELETE returns 204 No Content
      expect(deleteResponse.status()).toBe(204);

      // Verify it's gone
      const getResponse = await page.request.get(`/api/v1/products/${productId}`);
      expect(getResponse.status()).toBe(404);
    });

    test('should return 404 for non-existent product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Valid UUID format but doesn't exist
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.delete(`/api/v1/products/${fakeId}`);

      expect(response.status()).toBe(404);
    });
  });

  test.describe('Response Format', () => {
    test('should use standardized success response format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const createResponse = await page.request.post('/api/v1/products', {
        data: {
          name: 'Format Test',
          slug: uniqueSlug(),
          description: 'Testing response format',
          price: 10.00
        }
      });

      expect(createResponse.status()).toBe(201);
      const body = await createResponse.json();

      // Should have data property at root
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('name');

      testProducts.push(body.data.id);
    });

    test('should use standardized error response format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/products', {
        data: {} // empty body
      });

      expect(response.status()).toBe(400);
      const body = await response.json();

      // Should have error object with code and message
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(typeof body.error.code).toBe('string');
      expect(typeof body.error.message).toBe('string');
    });
  });
});
