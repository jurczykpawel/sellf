/**
 * API Integration Tests: Users
 *
 * Migrated from api-v1-users.spec.ts (Playwright → Vitest)
 * Tests user listing, access management, and error handling.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, post, patch, del, deleteTestApiKey, API_URL, supabase } from './setup';

interface User {
  id: string;
  email: string;
  full_name?: string;
  stats: {
    total_products: number;
    total_value: number;
  };
  product_access?: UserAccess[];
  created_at: string;
}

interface UserAccess {
  id: string;
  user_id: string;
  product_id: string;
  product_name?: string;
  granted_at: string;
  expires_at?: string;
  duration_days?: number;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

// Helper to create unique slug
const uniqueSlug = () => `test-product-${Date.now()}-${Math.random().toString(36).substring(7)}`;

describe('Users API v1', () => {
  let testUserId: string;
  let testUserEmail: string;
  let testProductId: string;
  const createdAccessIds: string[] = [];
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create a test user
    testUserEmail = `test-user-${randomStr}@example.com`;
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: testUserEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { full_name: 'Test User' },
    });

    if (userError) throw userError;
    testUserId = userData.user!.id;

    // Create a test product for access tests
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        name: 'Test Product for Access',
        slug: uniqueSlug(),
        description: 'Product for testing user access',
        price: 2999,
        is_active: true,
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = product.id;

    // /api/v1/users reads seller_customer_stats (INNER JOIN on user_product_access
    // ∪ payment_transactions), so a freshly-created auth user is invisible until
    // they have at least one access row. Grant unlimited access to make the test
    // user appear in list/search/byId responses.
    const { error: accessError } = await supabase
      .from('user_product_access')
      .insert({ user_id: testUserId, product_id: testProductId });
    if (accessError) throw accessError;
  });

  afterAll(async () => {
    // Cleanup created access entries
    for (const accessId of createdAccessIds) {
      await supabase.from('user_product_access').delete().eq('id', accessId);
    }

    // Cleanup created products
    for (const productId of createdProductIds) {
      await supabase.from('products').delete().eq('id', productId);
    }

    // Cleanup test product
    if (testProductId) {
      await supabase.from('products').delete().eq('id', testProductId);
    }

    // Cleanup test user
    if (testUserId) {
      await supabase.auth.admin.deleteUser(testUserId);
    }

    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/users`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/users', () => {
    it('should return users list with pagination', async () => {
      const { status, data } = await get<ApiResponse<User[]>>('/api/v1/users');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
    });

    it('should include user stats in response', async () => {
      const { status, data } = await get<ApiResponse<User[]>>('/api/v1/users');

      expect(status).toBe(200);
      if (data.data!.length > 0) {
        const user = data.data![0];
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('stats');
        expect(user.stats).toHaveProperty('total_products');
        expect(user.stats).toHaveProperty('total_value');
      }
    });

    it('should support search by email', async () => {
      const { status, data } = await get<ApiResponse<User[]>>(`/api/v1/users?search=${testUserEmail}`);

      expect(status).toBe(200);
      expect(data.data!.some((u) => u.email === testUserEmail)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const { status, data } = await get<ApiResponse<User[]>>('/api/v1/users?limit=5');

      expect(status).toBe(200);
      expect(data.pagination!.limit).toBe(5);
      expect(data.data!.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('should return user details by ID', async () => {
      const { status, data } = await get<ApiResponse<User>>(`/api/v1/users/${testUserId}`);

      expect(status).toBe(200);
      expect(data.data!.id).toBe(testUserId);
      expect(data.data!.email).toBe(testUserEmail);
      expect(data.data!).toHaveProperty('stats');
      expect(data.data!).toHaveProperty('product_access');
    });

    it('should return 404 for non-existent user', async () => {
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const { status, data } = await get<ApiResponse<User>>(`/api/v1/users/${fakeId}`);

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid ID format', async () => {
      const { status, data } = await get<ApiResponse<User>>('/api/v1/users/invalid-id');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('POST /api/v1/users/:id/access', () => {
    it('should grant access to a product', async () => {
      // Create a unique product for this test
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'Grant Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing grant access',
          price: 2999,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      const { status, data } = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });

      expect(status).toBe(201);
      expect(data.data!.user_id).toBe(testUserId);
      expect(data.data!.product_id).toBe(product!.id);
      expect(data.data!).toHaveProperty('id');
      expect(data.data!).toHaveProperty('granted_at');

      createdAccessIds.push(data.data!.id);
    });

    it('should return error when user already has access', async () => {
      // Create a product and grant access first
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'Duplicate Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing duplicate access',
          price: 1999,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      // Grant access first
      const grantResult = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });
      createdAccessIds.push(grantResult.data.data!.id);

      // Try to grant access again
      const { status, data } = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });

      expect(status).toBe(409);
      expect(data.error!.code).toBe('ALREADY_EXISTS');
    });

    it('should grant access with duration', async () => {
      // Create a new product for this test
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'Duration Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing access duration',
          price: 1999,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      const { status, data } = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
        access_duration_days: 30,
      });

      expect(status).toBe(201);
      expect(data.data!.duration_days).toBe(30);
      expect(data.data!.expires_at).toBeTruthy();

      createdAccessIds.push(data.data!.id);
    });

    it('should return 404 for non-existent product', async () => {
      const fakeProductId = '11111111-1111-4111-a111-111111111111';
      const { status, data } = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: fakeProductId,
      });

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 404 for non-existent user', async () => {
      const fakeUserId = '11111111-1111-4111-a111-111111111111';
      const { status, data } = await post<ApiResponse<UserAccess>>(`/api/v1/users/${fakeUserId}/access`, {
        product_id: testProductId,
      });

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should validate required fields', async () => {
      const { status, data } = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {});

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  describe('GET /api/v1/users/:id/access', () => {
    it('should list user access', async () => {
      // Create product and grant access for this test
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'List Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing list access',
          price: 1599,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      const grantResult = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });
      createdAccessIds.push(grantResult.data.data!.id);

      const { status, data } = await get<ApiResponse<UserAccess[]>>(`/api/v1/users/${testUserId}/access`);

      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data!.length).toBeGreaterThanOrEqual(1);

      const access = data.data!.find((a) => a.product_id === product!.id);
      expect(access).toBeTruthy();
      expect(access!.product_name).toBe('List Access Test Product');
    });
  });

  describe('PATCH /api/v1/users/:id/access/:accessId', () => {
    it('should extend access by days', async () => {
      // Create product and grant access for this test
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'Extend Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing extend access',
          price: 1299,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      const grantResult = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });
      const accessId = grantResult.data.data!.id;
      createdAccessIds.push(accessId);

      const { status, data } = await patch<ApiResponse<UserAccess>>(
        `/api/v1/users/${testUserId}/access/${accessId}`,
        { extend_days: 30 }
      );

      expect(status).toBe(200);
      expect(data.data!.expires_at).toBeTruthy();
    });

    it('should set specific expiration date', async () => {
      // Create product and grant access for this test
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'Set Expiration Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing set expiration',
          price: 1199,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      const grantResult = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });
      const accessId = grantResult.data.data!.id;
      createdAccessIds.push(accessId);

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const { status, data } = await patch<ApiResponse<UserAccess>>(
        `/api/v1/users/${testUserId}/access/${accessId}`,
        { access_expires_at: futureDate.toISOString() }
      );

      expect(status).toBe(200);
      expect(data.data!.expires_at).toBeTruthy();
    });

    it('should return 404 for non-existent access', async () => {
      const fakeAccessId = '11111111-1111-4111-a111-111111111111';
      const { status } = await patch<ApiResponse<UserAccess>>(
        `/api/v1/users/${testUserId}/access/${fakeAccessId}`,
        { extend_days: 30 }
      );

      expect(status).toBe(404);
    });
  });

  describe('DELETE /api/v1/users/:id/access/:accessId', () => {
    it('should revoke access', async () => {
      // Create a new product and grant access for this test
      const { data: product } = await supabase
        .from('products')
        .insert({
          name: 'Delete Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing access deletion',
          price: 999,
          is_active: true,
        })
        .select()
        .single();

      createdProductIds.push(product!.id);

      // Grant access
      const grantResult = await post<ApiResponse<UserAccess>>(`/api/v1/users/${testUserId}/access`, {
        product_id: product!.id,
      });
      const accessId = grantResult.data.data!.id;

      // Delete access
      const { status } = await del<ApiResponse<null>>(`/api/v1/users/${testUserId}/access/${accessId}`);
      expect(status).toBe(204);

      // Verify access is gone
      const { status: getStatus } = await get<ApiResponse<UserAccess>>(
        `/api/v1/users/${testUserId}/access/${accessId}`
      );
      expect(getStatus).toBe(404);
    });

    it('should return 404 for non-existent access', async () => {
      const fakeAccessId = '11111111-1111-4111-a111-111111111111';
      const { status } = await del<ApiResponse<null>>(`/api/v1/users/${testUserId}/access/${fakeAccessId}`);

      expect(status).toBe(404);
    });
  });

  describe('Cursor Pagination', () => {
    it('should support cursor-based pagination', async () => {
      const response1 = await get<ApiResponse<User[]>>('/api/v1/users?limit=1');
      expect(response1.status).toBe(200);

      if (response1.data.pagination?.has_more && response1.data.pagination?.next_cursor) {
        const response2 = await get<ApiResponse<User[]>>(
          `/api/v1/users?limit=1&cursor=${response1.data.pagination.next_cursor}`
        );
        expect(response2.status).toBe(200);

        if (response2.data.data!.length > 0) {
          expect(response2.data.data![0].id).not.toBe(response1.data.data![0].id);
        }
      }
    });
  });

  describe('Response Format', () => {
    it('should use standardized success response format', async () => {
      const { status, data } = await get<ApiResponse<User>>(`/api/v1/users/${testUserId}`);

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('email');
    });

    it('should use standardized error response format', async () => {
      const { status, data } = await get<ApiResponse<User>>('/api/v1/users/invalid-id');

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
    });

    it('should include pagination in list responses', async () => {
      const { status, data } = await get<ApiResponse<User[]>>('/api/v1/users');

      expect(status).toBe(200);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
      expect(typeof data.pagination!.has_more).toBe('boolean');
    });
  });
});
