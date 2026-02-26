/**
 * API Integration Tests: Analytics
 *
 * Migrated from api-v1-analytics.spec.ts (Playwright → Vitest)
 * Tests dashboard, revenue, and top-products endpoints.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { get, deleteTestApiKey, API_URL } from './setup';

interface DashboardData {
  revenue: {
    today: number;
    this_week: number;
    this_month: number;
    total: number;
    by_currency: Record<string, number>;
  };
  transactions: {
    today: number;
    total: number;
  };
  products: {
    active: number;
    total: number;
  };
  users: {
    total: number;
    with_access: number;
  };
  refunds: {
    pending_count: number;
  };
  recent_activity: unknown[];
  generated_at: string;
  filters?: {
    product_id?: string;
  };
}

interface RevenueData {
  summary: {
    total_revenue: number;
    total_transactions: number;
    average_order_value: number;
    by_currency: Record<string, number>;
  };
  breakdown: { date: string; amount: number }[];
  comparison: {
    revenue_change_percent: number;
    transaction_change_percent: number;
    previous_period?: {
      start: string;
      end: string;
      revenue: number;
    };
  };
  filters: {
    period: string;
    group_by?: string;
    start_date?: string;
    end_date?: string;
  };
}

interface TopProductsData {
  products: Array<{
    id: string;
    name: string;
    revenue: number;
    sales_count: number;
    rank?: number;
    revenue_share?: number;
    sales_share?: number;
  }>;
  summary: {
    total_products: number;
    total_revenue: number;
    total_sales: number;
  };
  filters: {
    period: string;
    limit: number;
    sort_by: string;
  };
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

describe('Analytics API v1', () => {
  afterAll(async () => {
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests to dashboard', async () => {
      const response = await fetch(`${API_URL}/api/v1/analytics/dashboard`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated requests to revenue', async () => {
      const response = await fetch(`${API_URL}/api/v1/analytics/revenue`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated requests to top-products', async () => {
      const response = await fetch(`${API_URL}/api/v1/analytics/top-products`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/analytics/dashboard', () => {
    it('should return dashboard overview', async () => {
      const { status, data } = await get<ApiResponse<DashboardData>>('/api/v1/analytics/dashboard');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('revenue');
      expect(data.data!.revenue).toHaveProperty('today');
      expect(data.data!.revenue).toHaveProperty('this_week');
      expect(data.data!.revenue).toHaveProperty('this_month');
      expect(data.data!.revenue).toHaveProperty('total');
      expect(data.data!.revenue).toHaveProperty('by_currency');

      expect(data.data).toHaveProperty('transactions');
      expect(data.data!.transactions).toHaveProperty('today');
      expect(data.data!.transactions).toHaveProperty('total');

      expect(data.data).toHaveProperty('products');
      expect(data.data!.products).toHaveProperty('active');
      expect(data.data!.products).toHaveProperty('total');

      expect(data.data).toHaveProperty('users');
      expect(data.data!.users).toHaveProperty('total');
      expect(data.data!.users).toHaveProperty('with_access');

      expect(data.data).toHaveProperty('refunds');
      expect(data.data!.refunds).toHaveProperty('pending_count');

      expect(data.data).toHaveProperty('recent_activity');
      expect(Array.isArray(data.data!.recent_activity)).toBe(true);

      expect(data.data).toHaveProperty('generated_at');
    });

    it('should support product_id filter', async () => {
      // Use a fake product ID - should still work, just return zeros
      const { status, data } = await get<ApiResponse<DashboardData>>(
        '/api/v1/analytics/dashboard?product_id=11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(200);
      expect(data.data!.filters?.product_id).toBe('11111111-1111-4111-a111-111111111111');
    });
  });

  describe('GET /api/v1/analytics/revenue', () => {
    it('should return revenue stats with default period', async () => {
      const { status, data } = await get<ApiResponse<RevenueData>>('/api/v1/analytics/revenue');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('summary');
      expect(data.data!.summary).toHaveProperty('total_revenue');
      expect(data.data!.summary).toHaveProperty('total_transactions');
      expect(data.data!.summary).toHaveProperty('average_order_value');
      expect(data.data!.summary).toHaveProperty('by_currency');

      expect(data.data).toHaveProperty('breakdown');
      expect(Array.isArray(data.data!.breakdown)).toBe(true);

      expect(data.data).toHaveProperty('comparison');
      expect(data.data!.comparison).toHaveProperty('revenue_change_percent');
      expect(data.data!.comparison).toHaveProperty('transaction_change_percent');

      expect(data.data).toHaveProperty('filters');
      expect(data.data!.filters.period).toBe('month');
    });

    it('should support different periods', async () => {
      const periods = ['day', 'week', 'month', 'quarter', 'year'];

      for (const period of periods) {
        const { status, data } = await get<ApiResponse<RevenueData>>(
          `/api/v1/analytics/revenue?period=${period}`
        );

        expect(status).toBe(200);
        expect(data.data!.filters.period).toBe(period);
      }
    });

    it('should support custom date range', async () => {
      const startDate = '2025-01-01';
      const endDate = '2025-01-31';

      const { status, data } = await get<ApiResponse<RevenueData>>(
        `/api/v1/analytics/revenue?start_date=${startDate}&end_date=${endDate}`
      );

      expect(status).toBe(200);
      expect(data.data!.filters.start_date).toContain('2025-01-01');
    });

    it('should support group_by parameter', async () => {
      const { status, data } = await get<ApiResponse<RevenueData>>(
        '/api/v1/analytics/revenue?period=year&group_by=month'
      );

      expect(status).toBe(200);
      expect(data.data!.filters.group_by).toBe('month');
    });

    it('should return comparison with previous period', async () => {
      const { status, data } = await get<ApiResponse<RevenueData>>(
        '/api/v1/analytics/revenue?period=month'
      );

      expect(status).toBe(200);
      expect(data.data!.comparison).toHaveProperty('previous_period');
      expect(data.data!.comparison.previous_period).toHaveProperty('start');
      expect(data.data!.comparison.previous_period).toHaveProperty('end');
      expect(data.data!.comparison.previous_period).toHaveProperty('revenue');
    });
  });

  describe('GET /api/v1/analytics/top-products', () => {
    it('should return top products list', async () => {
      const { status, data } = await get<ApiResponse<TopProductsData>>('/api/v1/analytics/top-products');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('products');
      expect(Array.isArray(data.data!.products)).toBe(true);

      expect(data.data).toHaveProperty('summary');
      expect(data.data!.summary).toHaveProperty('total_products');
      expect(data.data!.summary).toHaveProperty('total_revenue');
      expect(data.data!.summary).toHaveProperty('total_sales');

      expect(data.data).toHaveProperty('filters');
      expect(data.data!.filters).toHaveProperty('period');
      expect(data.data!.filters).toHaveProperty('limit');
      expect(data.data!.filters).toHaveProperty('sort_by');
    });

    it('should respect limit parameter', async () => {
      const { status, data } = await get<ApiResponse<TopProductsData>>(
        '/api/v1/analytics/top-products?limit=5'
      );

      expect(status).toBe(200);
      expect(data.data!.filters.limit).toBe(5);
      expect(data.data!.products.length).toBeLessThanOrEqual(5);
    });

    it('should support sort_by parameter', async () => {
      const { status, data } = await get<ApiResponse<TopProductsData>>(
        '/api/v1/analytics/top-products?sort_by=sales'
      );

      expect(status).toBe(200);
      expect(data.data!.filters.sort_by).toBe('sales');
    });

    it('should reject invalid sort_by value', async () => {
      const { status, data } = await get<ApiResponse<TopProductsData>>(
        '/api/v1/analytics/top-products?sort_by=invalid'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should include rank and share percentages', async () => {
      const { status, data } = await get<ApiResponse<TopProductsData>>('/api/v1/analytics/top-products');

      expect(status).toBe(200);

      expect(data.data!.products.length).toBeGreaterThan(0);
      const firstProduct = data.data!.products[0];
      expect(firstProduct).toHaveProperty('rank');
      expect(firstProduct).toHaveProperty('revenue_share');
      expect(firstProduct).toHaveProperty('sales_share');
      expect(firstProduct.rank).toBe(1);
    });

    it('should support different periods', async () => {
      const { status, data } = await get<ApiResponse<TopProductsData>>(
        '/api/v1/analytics/top-products?period=year'
      );

      expect(status).toBe(200);
      expect(data.data!.filters.period).toBe('year');
    });
  });
});
