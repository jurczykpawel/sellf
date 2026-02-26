/**
 * API Integration Tests: Coupons
 *
 * Migrated from api-v1-coupons.spec.ts (Playwright → Vitest)
 * Tests cursor-based pagination, CRUD operations, and error handling.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { get, post, patch, del, cleanup, deleteTestApiKey, API_URL } from './setup';

interface Coupon {
  id: string;
  code: string;
  name?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  currency?: string;
  is_active: boolean;
  allowed_emails?: string[];
  usage_limit_global?: number;
  usage_limit_per_user?: number;
  created_at: string;
}

interface CouponStats {
  coupon_id: string;
  summary: {
    total_redemptions: number;
    total_discount_amount: number;
    unique_users: number;
    usage_limit_global?: number;
  };
  recent_redemptions: unknown[];
  daily_usage: unknown[];
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

// Helper to create unique coupon code
const uniqueCode = () => `TEST-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

describe('Coupons API v1', () => {
  const createdCouponIds: string[] = [];

  afterAll(async () => {
    await cleanup({ coupons: createdCouponIds });
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/coupons`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/coupons', () => {
    it('should return coupons list with pagination', async () => {
      const { status, data } = await get<ApiResponse<Coupon[]>>('/api/v1/coupons');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
    });

    it('should respect limit parameter', async () => {
      const { status, data } = await get<ApiResponse<Coupon[]>>('/api/v1/coupons?limit=5');

      expect(status).toBe(200);
      expect(data.data!.length).toBeLessThanOrEqual(5);
    });

    it('should filter by status=active', async () => {
      // Create an active coupon
      const activeCode = uniqueCode();
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: activeCode,
        discount_type: 'percentage',
        discount_value: 10,
        is_active: true,
      });
      if (createResult.data.data?.id) {
        createdCouponIds.push(createResult.data.data.id);
      }

      const { status, data } = await get<ApiResponse<Coupon[]>>('/api/v1/coupons?status=active');

      expect(status).toBe(200);
      for (const coupon of data.data!) {
        expect(coupon.is_active).toBe(true);
      }
    });

    it('should filter by status=inactive', async () => {
      // Create an inactive coupon
      const inactiveCode = uniqueCode();
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: inactiveCode,
        discount_type: 'percentage',
        discount_value: 10,
        is_active: false,
      });
      if (createResult.data.data?.id) {
        createdCouponIds.push(createResult.data.data.id);
      }

      const { status, data } = await get<ApiResponse<Coupon[]>>('/api/v1/coupons?status=inactive');

      expect(status).toBe(200);
      for (const coupon of data.data!) {
        expect(coupon.is_active).toBe(false);
      }
    });

    it('should support search parameter', async () => {
      const searchCode = `SEARCH-${Date.now()}`;
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: searchCode,
        name: 'Search Test Coupon',
        discount_type: 'percentage',
        discount_value: 15,
      });

      expect(createResult.status).toBe(201);
      if (createResult.data.data?.id) {
        createdCouponIds.push(createResult.data.data.id);
      }

      const { status, data } = await get<ApiResponse<Coupon[]>>(`/api/v1/coupons?search=${searchCode}`);

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      expect(data.data![0].code).toBe(searchCode);
    });

    it('should support cursor pagination', async () => {
      // Create a few coupons
      for (let i = 0; i < 3; i++) {
        const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
          code: uniqueCode(),
          discount_type: 'percentage',
          discount_value: 10 + i,
        });
        if (createResult.data.data?.id) {
          createdCouponIds.push(createResult.data.data.id);
        }
      }

      // Get first page
      const firstPage = await get<ApiResponse<Coupon[]>>('/api/v1/coupons?limit=2');
      expect(firstPage.status).toBe(200);
      expect(firstPage.data.data!.length).toBe(2);

      expect(firstPage.data.pagination?.next_cursor).toBeTruthy();

      const secondPage = await get<ApiResponse<Coupon[]>>(
        `/api/v1/coupons?limit=2&cursor=${firstPage.data.pagination!.next_cursor}`
      );
      expect(secondPage.status).toBe(200);

      // Ensure no duplicates
      const firstIds = firstPage.data.data!.map((c) => c.id);
      const secondIds = secondPage.data.data!.map((c) => c.id);
      const overlap = firstIds.filter((id) => secondIds.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe('POST /api/v1/coupons', () => {
    it('should create percentage discount coupon', async () => {
      const code = uniqueCode();
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code,
        name: 'Test Percentage Coupon',
        discount_type: 'percentage',
        discount_value: 25,
        usage_limit_per_user: 1,
      });

      expect(status).toBe(201);
      expect(data.data!.code).toBe(code);
      expect(data.data!.discount_type).toBe('percentage');
      expect(data.data!.discount_value).toBe(25);
      expect(data.data!.is_active).toBe(true);

      createdCouponIds.push(data.data!.id);
    });

    it('should create fixed discount coupon', async () => {
      const code = uniqueCode();
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code,
        discount_type: 'fixed',
        discount_value: 1000, // 10.00 in cents
        currency: 'PLN',
      });

      expect(status).toBe(201);
      expect(data.data!.code).toBe(code);
      expect(data.data!.discount_type).toBe('fixed');
      expect(data.data!.discount_value).toBe(1000);
      expect(data.data!.currency).toBe('PLN');

      createdCouponIds.push(data.data!.id);
    });

    it('should reject percentage discount over 100%', async () => {
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        discount_type: 'percentage',
        discount_value: 150,
      });

      expect(status).toBe(400);
      expect(data.error!.message).toContain('100%');
    });

    it('should reject fixed discount without currency', async () => {
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        discount_type: 'fixed',
        discount_value: 1000,
      });

      expect(status).toBe(400);
      expect(data.error!.message.toLowerCase()).toContain('currency');
    });

    it('should reject duplicate coupon code', async () => {
      const code = uniqueCode();

      // Create first coupon
      const first = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code,
        discount_type: 'percentage',
        discount_value: 10,
      });
      expect(first.status).toBe(201);
      createdCouponIds.push(first.data.data!.id);

      // Try to create duplicate
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code,
        discount_type: 'percentage',
        discount_value: 20,
      });

      expect(status).toBe(409);
      expect(data.error!.code).toBe('CONFLICT');
    });

    it('should normalize code to uppercase', async () => {
      const lowerCode = `lowercase-${Date.now()}`;
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: lowerCode,
        discount_type: 'percentage',
        discount_value: 10,
      });

      expect(status).toBe(201);
      expect(data.data!.code).toBe(lowerCode.toUpperCase());

      createdCouponIds.push(data.data!.id);
    });

    it('should reject missing required fields', async () => {
      const { status } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        name: 'Missing Fields',
      });

      expect(status).toBe(400);
    });
  });

  describe('GET /api/v1/coupons/:id', () => {
    let testCouponId: string;

    it('should return coupon details', async () => {
      const code = uniqueCode();
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code,
        name: 'Details Test Coupon',
        discount_type: 'percentage',
        discount_value: 30,
        allowed_emails: ['test@example.com'],
        usage_limit_global: 100,
      });

      testCouponId = createResult.data.data!.id;
      createdCouponIds.push(testCouponId);

      const { status, data } = await get<ApiResponse<Coupon>>(`/api/v1/coupons/${testCouponId}`);

      expect(status).toBe(200);
      expect(data.data!.id).toBe(testCouponId);
      expect(data.data!.code).toBe(code);
      expect(data.data!.name).toBe('Details Test Coupon');
      expect(data.data!.discount_type).toBe('percentage');
      expect(data.data!.discount_value).toBe(30);
      expect(data.data!.allowed_emails).toContain('test@example.com');
      expect(data.data!.usage_limit_global).toBe(100);
    });

    it('should return 404 for non-existent coupon', async () => {
      const { status, data } = await get<ApiResponse<Coupon>>(
        '/api/v1/coupons/11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid UUID', async () => {
      const { status, data } = await get<ApiResponse<Coupon>>('/api/v1/coupons/invalid-id');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /api/v1/coupons/:id', () => {
    let testCouponId: string;

    it('should update coupon fields', async () => {
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        name: 'Original Name',
        discount_type: 'percentage',
        discount_value: 10,
        is_active: true,
      });

      testCouponId = createResult.data.data!.id;
      createdCouponIds.push(testCouponId);

      const { status, data } = await patch<ApiResponse<Coupon>>(`/api/v1/coupons/${testCouponId}`, {
        name: 'Updated Name',
        discount_value: 20,
        is_active: false,
      });

      expect(status).toBe(200);
      expect(data.data!.name).toBe('Updated Name');
      expect(data.data!.discount_value).toBe(20);
      expect(data.data!.is_active).toBe(false);
    });

    it('should reject update with no valid fields', async () => {
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        discount_type: 'percentage',
        discount_value: 10,
      });

      const couponId = createResult.data.data!.id;
      createdCouponIds.push(couponId);

      const { status } = await patch<ApiResponse<Coupon>>(`/api/v1/coupons/${couponId}`, {});

      expect(status).toBe(400);
    });

    it('should return 404 for non-existent coupon', async () => {
      const { status } = await patch<ApiResponse<Coupon>>(
        '/api/v1/coupons/11111111-1111-4111-a111-111111111111',
        { name: 'Test' }
      );

      expect(status).toBe(404);
    });

    it('should reject invalid discount value', async () => {
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        discount_type: 'percentage',
        discount_value: 10,
      });

      const couponId = createResult.data.data!.id;
      createdCouponIds.push(couponId);

      const { status } = await patch<ApiResponse<Coupon>>(`/api/v1/coupons/${couponId}`, {
        discount_value: 150,
      });

      expect(status).toBe(400);
    });
  });

  describe('DELETE /api/v1/coupons/:id', () => {
    it('should delete coupon', async () => {
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        discount_type: 'percentage',
        discount_value: 10,
      });

      const couponId = createResult.data.data!.id;

      const { status } = await del<ApiResponse<null>>(`/api/v1/coupons/${couponId}`);
      expect(status).toBe(204);

      // Verify it's gone
      const { status: getStatus } = await get<ApiResponse<Coupon>>(`/api/v1/coupons/${couponId}`);
      expect(getStatus).toBe(404);
    });

    it('should return 404 for non-existent coupon', async () => {
      const { status } = await del<ApiResponse<null>>(
        '/api/v1/coupons/11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(404);
    });
  });

  describe('GET /api/v1/coupons/:id/stats', () => {
    it('should return coupon statistics', async () => {
      const createResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        name: 'Stats Test Coupon',
        discount_type: 'percentage',
        discount_value: 15,
        usage_limit_global: 50,
      });

      const couponId = createResult.data.data!.id;
      createdCouponIds.push(couponId);

      const { status, data } = await get<ApiResponse<CouponStats>>(`/api/v1/coupons/${couponId}/stats`);

      expect(status).toBe(200);
      expect(data.data!.coupon_id).toBe(couponId);
      expect(data.data!).toHaveProperty('summary');
      expect(data.data!.summary).toHaveProperty('total_redemptions');
      expect(data.data!.summary).toHaveProperty('total_discount_amount');
      expect(data.data!.summary).toHaveProperty('unique_users');
      expect(data.data!.summary.usage_limit_global).toBe(50);
      expect(data.data!).toHaveProperty('recent_redemptions');
      expect(data.data!).toHaveProperty('daily_usage');
      expect(Array.isArray(data.data!.daily_usage)).toBe(true);
    });

    it('should return 404 for non-existent coupon', async () => {
      const { status } = await get<ApiResponse<CouponStats>>(
        '/api/v1/coupons/11111111-1111-4111-a111-111111111111/stats'
      );

      expect(status).toBe(404);
    });
  });

  describe('Response Format', () => {
    it('should use standardized success response format', async () => {
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
        code: uniqueCode(),
        discount_type: 'percentage',
        discount_value: 10,
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('code');
      expect(data.data).toHaveProperty('discount_type');
      expect(data.data).toHaveProperty('discount_value');
      expect(data.data).toHaveProperty('created_at');

      createdCouponIds.push(data.data!.id);
    });

    it('should use standardized error response format', async () => {
      const { status, data } = await post<ApiResponse<Coupon>>('/api/v1/coupons', {});

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
      expect(typeof data.error!.code).toBe('string');
      expect(typeof data.error!.message).toBe('string');
    });

    it('should include pagination in list responses', async () => {
      const { status, data } = await get<ApiResponse<Coupon[]>>('/api/v1/coupons');

      expect(status).toBe(200);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
      expect(typeof data.pagination!.has_more).toBe('boolean');
    });
  });
});
