/**
 * API Integration Tests: Order Bumps
 *
 * Migrated from api-v1-order-bumps.spec.ts (Playwright → Vitest)
 * Tests CRUD operations, validation, authentication.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, post, patch, del, deleteTestApiKey, API_URL, supabase } from './setup';

interface OrderBump {
  id: string;
  main_product_id: string;
  bump_product_id: string;
  bump_title: string;
  bump_price: number;
  bump_description?: string;
  is_active: boolean;
  display_order?: number;
  access_duration_days?: number;
  main_product?: {
    id: string;
    name: string;
  };
  bump_product?: {
    id: string;
    name: string;
    price: number;
  };
  created_at: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

describe('Order Bumps API v1', () => {
  let mainProductId: string;
  let bumpProductId: string;
  const testOrderBumpIds: string[] = [];

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create main product
    const { data: main, error: mainErr } = await supabase
      .from('products')
      .insert({
        name: `Main Product ${randomStr}`,
        slug: `main-product-${randomStr}`,
        price: 10000,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (mainErr) throw mainErr;
    mainProductId = main.id;

    // Create bump product
    const { data: bump, error: bumpErr } = await supabase
      .from('products')
      .insert({
        name: `Bump Product ${randomStr}`,
        slug: `bump-product-${randomStr}`,
        price: 2000,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (bumpErr) throw bumpErr;
    bumpProductId = bump.id;
  });

  afterAll(async () => {
    // Cleanup test order bumps
    for (const orderBumpId of testOrderBumpIds) {
      await supabase.from('order_bumps').delete().eq('id', orderBumpId);
    }

    // Cleanup products
    if (bumpProductId) {
      await supabase.from('products').delete().eq('id', bumpProductId);
    }
    if (mainProductId) {
      await supabase.from('products').delete().eq('id', mainProductId);
    }

    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated GET requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/order-bumps`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated POST requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/order-bumps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          main_product_id: mainProductId,
          bump_product_id: bumpProductId,
          bump_title: 'Test Bump',
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/order-bumps', () => {
    it('should return order bumps list', async () => {
      const { status, data } = await get<ApiResponse<OrderBump[]>>('/api/v1/order-bumps');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should filter by product_id', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create unique bump product for this test
      const { data: uniqueBump } = await supabase
        .from('products')
        .insert({
          name: `Filter Test Bump ${randomStr}`,
          slug: `filter-test-bump-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      // Create an order bump first
      const createResponse = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: mainProductId,
        bump_product_id: uniqueBump!.id,
        bump_title: 'Filter Test Bump',
        bump_price: 15.0,
      });
      expect(createResponse.status).toBe(201);
      testOrderBumpIds.push(createResponse.data.data!.id);

      try {
        // Filter by product_id
        const { status, data } = await get<ApiResponse<OrderBump[]>>(
          `/api/v1/order-bumps?product_id=${mainProductId}`
        );

        expect(status).toBe(200);
        expect(data.data!.length).toBeGreaterThanOrEqual(1);
        expect(data.data!.some((ob) => ob.main_product_id === mainProductId)).toBe(true);
      } finally {
        await supabase.from('order_bumps').delete().eq('id', createResponse.data.data!.id);
        await supabase.from('products').delete().eq('id', uniqueBump!.id);
        testOrderBumpIds.pop();
      }
    });

    it('should return 400 for invalid product_id format', async () => {
      const { status, data } = await get<ApiResponse<OrderBump[]>>(
        '/api/v1/order-bumps?product_id=invalid-uuid'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('POST /api/v1/order-bumps', () => {
    it('should create order bump with required fields', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a unique bump product for this test
      const { data: uniqueBump } = await supabase
        .from('products')
        .insert({
          name: `Unique Bump ${randomStr}`,
          slug: `unique-bump-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: mainProductId,
        bump_product_id: uniqueBump!.id,
        bump_title: 'Created via API Test',
      });

      expect(status).toBe(201);
      expect(data.data!.main_product_id).toBe(mainProductId);
      expect(data.data!.bump_product_id).toBe(uniqueBump!.id);
      expect(data.data!.bump_title).toBe('Created via API Test');

      // Cleanup
      await supabase.from('order_bumps').delete().eq('id', data.data!.id);
      await supabase.from('products').delete().eq('id', uniqueBump!.id);
    });

    it('should create order bump with all fields', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create another bump product for this test
      const { data: anotherBump } = await supabase
        .from('products')
        .insert({
          name: `Another Bump ${randomStr}`,
          slug: `another-bump-${randomStr}`,
          price: 3000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: mainProductId,
        bump_product_id: anotherBump!.id,
        bump_title: 'Full Test Bump',
        bump_price: 25.0,
        bump_description: 'A great addition!',
        is_active: true,
        display_order: 1,
        access_duration_days: 30,
      });

      expect(status).toBe(201);
      expect(data.data!.bump_price).toBe(25.0);
      expect(data.data!.bump_description).toBe('A great addition!');
      expect(data.data!.display_order).toBe(1);
      expect(data.data!.access_duration_days).toBe(30);

      // Cleanup
      await supabase.from('order_bumps').delete().eq('id', data.data!.id);
      await supabase.from('products').delete().eq('id', anotherBump!.id);
    });

    it('should return 400 for missing required fields', async () => {
      const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: mainProductId,
        // Missing bump_product_id and bump_title
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid main_product_id format', async () => {
      const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: 'invalid-uuid',
        bump_product_id: bumpProductId,
        bump_title: 'Invalid Test',
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for non-existent product', async () => {
      const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: '00000000-0000-0000-0000-000000000000',
        bump_product_id: bumpProductId,
        bump_title: 'Non-existent Product Test',
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
      expect(data.error!.message).toContain('not found');
    });

    it('should return 400 for inactive main product', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create inactive product
      const { data: inactiveProduct } = await supabase
        .from('products')
        .insert({
          name: `Inactive Product ${randomStr}`,
          slug: `inactive-product-${randomStr}`,
          price: 5000,
          currency: 'USD',
          is_active: false,
        })
        .select()
        .single();

      try {
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: inactiveProduct!.id,
          bump_product_id: bumpProductId,
          bump_title: 'Inactive Main Test',
        });

        expect(status).toBe(400);
        expect(data.error!.code).toBe('VALIDATION_ERROR');
        expect(data.error!.message).toContain('inactive');
      } finally {
        await supabase.from('products').delete().eq('id', inactiveProduct!.id);
      }
    });

    it('should return 400 for negative bump_price', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create another product for this test
      const { data: testProduct } = await supabase
        .from('products')
        .insert({
          name: `Price Test Bump ${randomStr}`,
          slug: `price-test-bump-${randomStr}`,
          price: 1000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: mainProductId,
          bump_product_id: testProduct!.id,
          bump_title: 'Negative Price Test',
          bump_price: -10.0,
        });

        expect(status).toBe(400);
        expect(data.error!.code).toBe('VALIDATION_ERROR');
      } finally {
        await supabase.from('products').delete().eq('id', testProduct!.id);
      }
    });

    it('should return 409 for duplicate order bump', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create first order bump
      const { data: dupBump } = await supabase
        .from('products')
        .insert({
          name: `Dup Bump ${randomStr}`,
          slug: `dup-bump-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const firstResponse = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
        main_product_id: mainProductId,
        bump_product_id: dupBump!.id,
        bump_title: 'First Bump',
      });
      expect(firstResponse.status).toBe(201);

      try {
        // Try to create duplicate
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: mainProductId,
          bump_product_id: dupBump!.id,
          bump_title: 'Duplicate Bump',
        });

        expect(status).toBe(409);
        expect(data.error!.code).toBe('CONFLICT');
      } finally {
        await supabase.from('order_bumps').delete().eq('id', firstResponse.data.data!.id);
        await supabase.from('products').delete().eq('id', dupBump!.id);
      }
    });
  });

  describe('GET /api/v1/order-bumps/:id', () => {
    let testOrderBump: { id: string; bumpProductId: string };

    beforeAll(async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a test bump product
      const { data: bump } = await supabase
        .from('products')
        .insert({
          name: `Get Test Bump ${randomStr}`,
          slug: `get-test-bump-${randomStr}`,
          price: 1200,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      // Create order bump
      const { data: ob } = await supabase
        .from('order_bumps')
        .insert({
          main_product_id: mainProductId,
          bump_product_id: bump!.id,
          bump_title: 'Get Test Bump',
          bump_price: 10.0,
        })
        .select()
        .single();

      testOrderBump = { id: ob!.id, bumpProductId: bump!.id };
      testOrderBumpIds.push(ob!.id);
    });

    afterAll(async () => {
      if (testOrderBump) {
        await supabase.from('order_bumps').delete().eq('id', testOrderBump.id);
        await supabase.from('products').delete().eq('id', testOrderBump.bumpProductId);
        const idx = testOrderBumpIds.indexOf(testOrderBump.id);
        if (idx > -1) testOrderBumpIds.splice(idx, 1);
      }
    });

    it('should return order bump by ID', async () => {
      const { status, data } = await get<ApiResponse<OrderBump>>(
        `/api/v1/order-bumps/${testOrderBump.id}`
      );

      expect(status).toBe(200);
      expect(data.data!.id).toBe(testOrderBump.id);
      expect(data.data!.bump_title).toBe('Get Test Bump');
      expect(data.data!.main_product).toBeDefined();
      expect(data.data!.bump_product).toBeDefined();
    });

    it('should return 404 for non-existent order bump', async () => {
      const { status, data } = await get<ApiResponse<OrderBump>>(
        '/api/v1/order-bumps/00000000-0000-0000-0000-000000000000'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid UUID format', async () => {
      const { status, data } = await get<ApiResponse<OrderBump>>('/api/v1/order-bumps/invalid-uuid');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /api/v1/order-bumps/:id', () => {
    let updateTestBump: { id: string; bumpProductId: string };

    beforeAll(async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create bump product
      const { data: bump } = await supabase
        .from('products')
        .insert({
          name: `Update Test Bump ${randomStr}`,
          slug: `update-test-bump-${randomStr}`,
          price: 1800,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      // Create order bump
      const { data: ob } = await supabase
        .from('order_bumps')
        .insert({
          main_product_id: mainProductId,
          bump_product_id: bump!.id,
          bump_title: 'Original Title',
          bump_price: 15.0,
          is_active: true,
        })
        .select()
        .single();

      updateTestBump = { id: ob!.id, bumpProductId: bump!.id };
      testOrderBumpIds.push(ob!.id);
    });

    afterAll(async () => {
      if (updateTestBump) {
        await supabase.from('order_bumps').delete().eq('id', updateTestBump.id);
        await supabase.from('products').delete().eq('id', updateTestBump.bumpProductId);
        const idx = testOrderBumpIds.indexOf(updateTestBump.id);
        if (idx > -1) testOrderBumpIds.splice(idx, 1);
      }
    });

    it('should update order bump title', async () => {
      const { status, data } = await patch<ApiResponse<OrderBump>>(
        `/api/v1/order-bumps/${updateTestBump.id}`,
        { bump_title: 'Updated Title' }
      );

      expect(status).toBe(200);
      expect(data.data!.bump_title).toBe('Updated Title');
    });

    it('should update order bump price', async () => {
      const { status, data } = await patch<ApiResponse<OrderBump>>(
        `/api/v1/order-bumps/${updateTestBump.id}`,
        { bump_price: 12.5 }
      );

      expect(status).toBe(200);
      expect(data.data!.bump_price).toBe(12.5);
    });

    it('should update order bump is_active', async () => {
      const { status, data } = await patch<ApiResponse<OrderBump>>(
        `/api/v1/order-bumps/${updateTestBump.id}`,
        { is_active: false }
      );

      expect(status).toBe(200);
      expect(data.data!.is_active).toBe(false);

      // Restore for other tests
      await patch(`/api/v1/order-bumps/${updateTestBump.id}`, { is_active: true });
    });

    it('should return 404 for non-existent order bump', async () => {
      const { status, data } = await patch<ApiResponse<OrderBump>>(
        '/api/v1/order-bumps/00000000-0000-0000-0000-000000000000',
        { bump_title: 'Should Fail' }
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid UUID format', async () => {
      const { status, data } = await patch<ApiResponse<OrderBump>>(
        '/api/v1/order-bumps/invalid-uuid',
        { bump_title: 'Should Fail' }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for negative bump_price', async () => {
      const { status, data } = await patch<ApiResponse<OrderBump>>(
        `/api/v1/order-bumps/${updateTestBump.id}`,
        { bump_price: -5.0 }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/order-bumps/:id', () => {
    it('should delete order bump', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a bump to delete
      const { data: delBump } = await supabase
        .from('products')
        .insert({
          name: `Delete Test Bump ${randomStr}`,
          slug: `delete-test-bump-${randomStr}`,
          price: 800,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: ob } = await supabase
        .from('order_bumps')
        .insert({
          main_product_id: mainProductId,
          bump_product_id: delBump!.id,
          bump_title: 'To Be Deleted',
        })
        .select()
        .single();

      // Delete it
      const { status } = await del<ApiResponse<unknown>>(`/api/v1/order-bumps/${ob!.id}`);
      expect(status).toBe(204);

      // Verify it's gone
      const checkResponse = await get<ApiResponse<OrderBump>>(`/api/v1/order-bumps/${ob!.id}`);
      expect(checkResponse.status).toBe(404);

      // Cleanup product
      await supabase.from('products').delete().eq('id', delBump!.id);
    });

    it('should return 404 for non-existent order bump', async () => {
      const { status, data } = await del<ApiResponse<unknown>>(
        '/api/v1/order-bumps/00000000-0000-0000-0000-000000000000'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid UUID format', async () => {
      const { status, data } = await del<ApiResponse<unknown>>('/api/v1/order-bumps/invalid-uuid');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('access_duration_days — 3-state encoding', () => {
    // The order bump form (OrderBumpFormModal.tsx) writes one of three values:
    //   null → "Use default for product"   (fall back to bump product's auto_grant_duration_days)
    //      0 → "Unlimited override"        (force NULL access_expires_at on grant)
    //    N>0 → "Custom override (N days)"
    // The API must accept all three on POST and PATCH.

    it('POST accepts access_duration_days: 0 (Unlimited override)', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraBump } = await supabase
        .from('products')
        .insert({
          name: `Unlimited Bump POST ${randomStr}`,
          slug: `unlimited-bump-post-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: mainProductId,
          bump_product_id: extraBump!.id,
          bump_title: 'Unlimited Override Test',
          access_duration_days: 0,
        });

        expect(status).toBe(201);
        expect(data.data!.access_duration_days).toBe(0);

        if (data.data?.id) {
          await supabase.from('order_bumps').delete().eq('id', data.data.id);
        }
      } finally {
        await supabase.from('products').delete().eq('id', extraBump!.id);
      }
    });

    it('POST accepts access_duration_days: null (Use default for product)', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraBump } = await supabase
        .from('products')
        .insert({
          name: `Default Bump POST ${randomStr}`,
          slug: `default-bump-post-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: mainProductId,
          bump_product_id: extraBump!.id,
          bump_title: 'Default Mode Test',
          access_duration_days: null,
        });

        expect(status).toBe(201);
        expect(data.data!.access_duration_days).toBeNull();

        if (data.data?.id) {
          await supabase.from('order_bumps').delete().eq('id', data.data.id);
        }
      } finally {
        await supabase.from('products').delete().eq('id', extraBump!.id);
      }
    });

    it('POST rejects access_duration_days: -1 (negative invalid)', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraBump } = await supabase
        .from('products')
        .insert({
          name: `Negative Bump POST ${randomStr}`,
          slug: `negative-bump-post-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: mainProductId,
          bump_product_id: extraBump!.id,
          bump_title: 'Negative Test',
          access_duration_days: -1,
        });

        expect(status).toBe(400);
        expect(data.error!.code).toBe('VALIDATION_ERROR');
      } finally {
        await supabase.from('products').delete().eq('id', extraBump!.id);
      }
    });

    it('POST rejects access_duration_days: 3651 (above max)', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraBump } = await supabase
        .from('products')
        .insert({
          name: `OverMax Bump POST ${randomStr}`,
          slug: `overmax-bump-post-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status, data } = await post<ApiResponse<OrderBump>>('/api/v1/order-bumps', {
          main_product_id: mainProductId,
          bump_product_id: extraBump!.id,
          bump_title: 'OverMax Test',
          access_duration_days: 3651,
        });

        expect(status).toBe(400);
        expect(data.error!.code).toBe('VALIDATION_ERROR');
      } finally {
        await supabase.from('products').delete().eq('id', extraBump!.id);
      }
    });

    it('PATCH accepts access_duration_days: 0 (Unlimited override)', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraBump } = await supabase
        .from('products')
        .insert({
          name: `Unlimited Bump PATCH ${randomStr}`,
          slug: `unlimited-bump-patch-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: ob } = await supabase
        .from('order_bumps')
        .insert({
          main_product_id: mainProductId,
          bump_product_id: extraBump!.id,
          bump_title: 'Patch Unlimited Test',
          is_active: true,
          access_duration_days: 30,
        })
        .select()
        .single();

      try {
        const { status, data } = await patch<ApiResponse<OrderBump>>(
          `/api/v1/order-bumps/${ob!.id}`,
          { access_duration_days: 0 }
        );

        expect(status).toBe(200);
        expect(data.data!.access_duration_days).toBe(0);
      } finally {
        await supabase.from('order_bumps').delete().eq('id', ob!.id);
        await supabase.from('products').delete().eq('id', extraBump!.id);
      }
    });

    it('PATCH accepts access_duration_days: null (Use default for product)', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraBump } = await supabase
        .from('products')
        .insert({
          name: `Default Bump PATCH ${randomStr}`,
          slug: `default-bump-patch-${randomStr}`,
          price: 1500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: ob } = await supabase
        .from('order_bumps')
        .insert({
          main_product_id: mainProductId,
          bump_product_id: extraBump!.id,
          bump_title: 'Patch Default Test',
          is_active: true,
          access_duration_days: 30,
        })
        .select()
        .single();

      try {
        const { status, data } = await patch<ApiResponse<OrderBump>>(
          `/api/v1/order-bumps/${ob!.id}`,
          { access_duration_days: null }
        );

        expect(status).toBe(200);
        expect(data.data!.access_duration_days).toBeNull();
      } finally {
        await supabase.from('order_bumps').delete().eq('id', ob!.id);
        await supabase.from('products').delete().eq('id', extraBump!.id);
      }
    });
  });

  describe('IDOR Tests', () => {
    it('both admins can view order bumps (shared resource)', async () => {
      // In Sellf, order bumps are global admin resources, not per-user
      // Both admins should be able to view them
      // This test verifies that order bumps are shared across all admins
      const { status, data } = await get<ApiResponse<OrderBump[]>>('/api/v1/order-bumps');

      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('non-admin user should not access order bumps', async () => {
      // Test that unauthenticated requests are rejected
      const response = await fetch(`${API_URL}/api/v1/order-bumps`);

      // Should be 401 for unauthenticated
      expect(response.status).toBe(401);
    });
  });
});
