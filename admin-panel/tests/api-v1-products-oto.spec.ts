/**
 * Tests for Products OTO (One-Time Offer) API v1
 *
 * GET /api/v1/products/[id]/oto - Get OTO configuration
 * PUT /api/v1/products/[id]/oto - Save/Update OTO configuration
 * DELETE /api/v1/products/[id]/oto - Delete OTO configuration
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

test.describe('Products OTO API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let sourceProduct: any;
  let otoProduct: any;

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `oto-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'OTO API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create source product
    const { data: source, error: sourceErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `OTO Source Product ${randomStr}`,
        slug: `oto-source-${randomStr}`,
        price: 100.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (sourceErr) throw sourceErr;
    sourceProduct = source;

    // Create OTO product
    const { data: oto, error: otoErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `OTO Offer Product ${randomStr}`,
        slug: `oto-offer-${randomStr}`,
        price: 50.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (otoErr) throw otoErr;
    otoProduct = oto;
  });

  test.afterAll(async () => {
    // Cleanup OTO offers
    if (sourceProduct) {
      await supabaseAdmin.from('oto_offers').delete().eq('source_product_id', sourceProduct.id);
    }

    // Cleanup products
    if (otoProduct) {
      await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
    }
    if (sourceProduct) {
      await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    }

    // Cleanup admin
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated GET requests', async ({ request }) => {
      expect(sourceProduct).toBeDefined();
      const response = await request.get(`/api/v1/products/${sourceProduct.id}/oto`);
      expect(response.status()).toBe(401);
    });

    test('should return 401 for unauthenticated PUT requests', async ({ request }) => {
      expect(sourceProduct).toBeDefined();
      expect(otoProduct).toBeDefined();
      const response = await request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: { oto_product_id: otoProduct.id }
      });
      expect(response.status()).toBe(401);
    });

    test('should return 401 for unauthenticated DELETE requests', async ({ request }) => {
      expect(sourceProduct).toBeDefined();
      const response = await request.delete(`/api/v1/products/${sourceProduct.id}/oto`);
      expect(response.status()).toBe(401);
    });
  });

  test.describe('GET /api/v1/products/[id]/oto', () => {
    test('should return has_oto: false when no OTO configured', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/products/${sourceProduct.id}/oto`);

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.has_oto).toBe(false);
    });

    test('should return 400 for invalid product ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/products/invalid-uuid/oto');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 404 for non-existent product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/products/00000000-0000-0000-0000-000000000000/oto');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  test.describe('PUT /api/v1/products/[id]/oto', () => {
    test('should create OTO configuration with defaults', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: {
          oto_product_id: otoProduct.id,
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.has_oto).toBe(true);
      expect(body.data.oto_product_id).toBe(otoProduct.id);
      expect(body.data.discount_type).toBe('percentage');
      expect(body.data.discount_value).toBe(20);
      expect(body.data.duration_minutes).toBe(15);
    });

    test('should create OTO configuration with custom values', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create another product for this test
      const randomStr = Math.random().toString(36).substring(7);
      const { data: customOto } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Custom OTO ${randomStr}`,
          slug: `custom-oto-${randomStr}`,
          price: 30.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
          data: {
            oto_product_id: customOto!.id,
            discount_type: 'fixed',
            discount_value: 10,
            duration_minutes: 30,
          }
        });

        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.data.has_oto).toBe(true);
        expect(body.data.discount_type).toBe('fixed');
        expect(body.data.discount_value).toBe(10);
        expect(body.data.duration_minutes).toBe(30);
      } finally {
        await supabaseAdmin.from('oto_offers').delete().eq('oto_product_id', customOto!.id);
        await supabaseAdmin.from('products').delete().eq('id', customOto!.id);
      }
    });

    test('should return 400 for missing oto_product_id', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for invalid oto_product_id format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: { oto_product_id: 'invalid-uuid' }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for non-existent OTO product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: { oto_product_id: '00000000-0000-0000-0000-000000000000' }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('not found');
    });

    test('should return 400 for invalid discount_type', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: {
          oto_product_id: otoProduct.id,
          discount_type: 'invalid',
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for negative discount_value', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: {
          oto_product_id: otoProduct.id,
          discount_value: -10,
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for invalid duration_minutes', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put(`/api/v1/products/${sourceProduct.id}/oto`, {
        data: {
          oto_product_id: otoProduct.id,
          duration_minutes: 0,
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 404 for non-existent source product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.put('/api/v1/products/00000000-0000-0000-0000-000000000000/oto', {
        data: { oto_product_id: otoProduct.id }
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  test.describe('DELETE /api/v1/products/[id]/oto', () => {
    test('should delete OTO configuration', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a fresh product pair for this test to avoid conflicts
      const randomStr = Math.random().toString(36).substring(7);
      const { data: delTestSource } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Delete Test Source ${randomStr}`,
          slug: `del-test-source-${randomStr}`,
          price: 60.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: delTestOto } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Delete Test OTO ${randomStr}`,
          slug: `del-test-oto-${randomStr}`,
          price: 20.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        // First create an OTO
        const createResponse = await page.request.put(`/api/v1/products/${delTestSource!.id}/oto`, {
          data: { oto_product_id: delTestOto!.id }
        });
        expect(createResponse.status()).toBe(200);

        // Then delete it
        const deleteResponse = await page.request.delete(`/api/v1/products/${delTestSource!.id}/oto`);
        expect(deleteResponse.status()).toBe(204);

        // Verify it's gone
        const getResponse = await page.request.get(`/api/v1/products/${delTestSource!.id}/oto`);
        expect(getResponse.status()).toBe(200);
        const body = await getResponse.json();
        expect(body.data.has_oto).toBe(false);
      } finally {
        // Cleanup
        await supabaseAdmin.from('oto_offers').delete().eq('source_product_id', delTestSource!.id);
        await supabaseAdmin.from('products').delete().eq('id', delTestOto!.id);
        await supabaseAdmin.from('products').delete().eq('id', delTestSource!.id);
      }
    });

    test('should return 400 for invalid product ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.delete('/api/v1/products/invalid-uuid/oto');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should succeed even if no OTO exists (idempotent)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a product with no OTO
      const randomStr = Math.random().toString(36).substring(7);
      const { data: noOtoProduct } = await supabaseAdmin
        .from('products')
        .insert({
          name: `No OTO Product ${randomStr}`,
          slug: `no-oto-${randomStr}`,
          price: 25.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const response = await page.request.delete(`/api/v1/products/${noOtoProduct!.id}/oto`);
        expect(response.status()).toBe(204);
      } finally {
        await supabaseAdmin.from('products').delete().eq('id', noOtoProduct!.id);
      }
    });
  });

  test.describe('OTO Lifecycle', () => {
    test('should replace existing OTO when PUT is called with different product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create fresh products for this test to avoid conflicts with other tests
      const randomStr = Math.random().toString(36).substring(7);

      const { data: lifecycleSource } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Lifecycle Source ${randomStr}`,
          slug: `lifecycle-source-${randomStr}`,
          price: 80.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: initialOto } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Initial OTO ${randomStr}`,
          slug: `initial-oto-${randomStr}`,
          price: 25.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: replacementOto } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Replacement OTO ${randomStr}`,
          slug: `replacement-oto-${randomStr}`,
          price: 35.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        // Create initial OTO
        const response1 = await page.request.put(`/api/v1/products/${lifecycleSource!.id}/oto`, {
          data: {
            oto_product_id: initialOto!.id,
            discount_type: 'percentage',
            discount_value: 10,
          }
        });
        expect(response1.status()).toBe(200);

        // Replace OTO with different product
        const response2 = await page.request.put(`/api/v1/products/${lifecycleSource!.id}/oto`, {
          data: {
            oto_product_id: replacementOto!.id,
            discount_type: 'fixed',
            discount_value: 25,
          }
        });
        expect(response2.status()).toBe(200);
        const body = await response2.json();
        expect(body.data.discount_type).toBe('fixed');
        expect(body.data.discount_value).toBe(25);
        expect(body.data.oto_product_id).toBe(replacementOto!.id);

        // Verify only one active OTO exists
        const getResponse = await page.request.get(`/api/v1/products/${lifecycleSource!.id}/oto`);
        expect(getResponse.status()).toBe(200);
        const getBody = await getResponse.json();
        expect(getBody.data.discount_type).toBe('fixed');
        expect(getBody.data.discount_value).toBe(25);
      } finally {
        // Cleanup
        await supabaseAdmin.from('oto_offers').delete().eq('source_product_id', lifecycleSource!.id);
        await supabaseAdmin.from('products').delete().eq('id', replacementOto!.id);
        await supabaseAdmin.from('products').delete().eq('id', initialOto!.id);
        await supabaseAdmin.from('products').delete().eq('id', lifecycleSource!.id);
      }
    });
  });
});
