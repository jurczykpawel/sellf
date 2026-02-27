/**
 * Analytics Toolset
 *
 * MCP tools for Sellf analytics and reporting.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient } from '../api-client.js';

interface DashboardData {
  revenue: {
    today: number;
    this_week: number;
    this_month: number;
    total: number;
    total_refunded: number;
    net_revenue: number;
    by_currency: Record<string, number>;
  };
  transactions: {
    today: number;
    this_week: number;
    this_month: number;
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
    total_refunded: number;
  };
  recent_activity: Array<{
    date: string;
    transactions: number;
    revenue: number;
  }>;
  generated_at: string;
}

interface TopProduct {
  product_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  current_price: number;
  current_currency: string;
  revenue: number;
  sales_count: number;
  average_price: number;
  by_currency: Record<string, { revenue: number; count: number }>;
  rank: number;
  revenue_share: number;
  sales_share: number;
}

interface PaymentStats {
  total_transactions: number;
  total_revenue: number;
  pending_count: number;
  refunded_amount: number;
  today_revenue: number;
  this_month_revenue: number;
}

export function registerAnalyticsTools(server: McpServer): void {
  // Get dashboard overview
  server.tool(
    'get_dashboard',
    'Get a comprehensive dashboard overview with key business metrics',
    {
      product_id: z.string().uuid().optional().describe('Filter stats by specific product'),
    },
    async ({ product_id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: DashboardData }>('/api/v1/analytics/dashboard', {
        product_id,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Get revenue stats
  server.tool(
    'get_revenue_stats',
    'Get detailed revenue statistics including trends and refunds',
    {},
    async () => {
      const api = getApiClient();
      const result = await api.get<{ data: PaymentStats }>('/api/v1/payments/stats');

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Get revenue by product
  server.tool(
    'get_revenue_by_product',
    'Get revenue breakdown by product for a specific period',
    {
      period: z.enum(['day', 'week', 'month', 'quarter', 'year', 'all']).optional().describe('Time period'),
    },
    async ({ period }) => {
      const api = getApiClient();
      const result = await api.get<{
        data: {
          products: TopProduct[];
          summary: { total_products: number; total_revenue: number; total_sales: number };
        };
      }>('/api/v1/analytics/top-products', {
        period,
        limit: 50,
        sort_by: 'revenue',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Get sales trends
  server.tool(
    'get_sales_trends',
    'Get sales trends showing daily activity over recent period',
    {
      product_id: z.string().uuid().optional().describe('Filter by specific product'),
    },
    async ({ product_id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: DashboardData }>('/api/v1/analytics/dashboard', {
        product_id,
      });

      // Extract and format trend data
      const trends = {
        daily_activity: result.data.recent_activity,
        summary: {
          total_days: result.data.recent_activity.length,
          total_transactions: result.data.recent_activity.reduce((sum, d) => sum + d.transactions, 0),
          total_revenue: result.data.recent_activity.reduce((sum, d) => sum + d.revenue, 0),
          avg_daily_transactions: Math.round(
            result.data.recent_activity.reduce((sum, d) => sum + d.transactions, 0) /
              result.data.recent_activity.length
          ),
          avg_daily_revenue: Math.round(
            result.data.recent_activity.reduce((sum, d) => sum + d.revenue, 0) /
              result.data.recent_activity.length
          ),
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(trends, null, 2) }],
      };
    }
  );

  // Get top products
  server.tool(
    'get_top_products',
    'Get the best performing products by revenue or sales count',
    {
      period: z.enum(['day', 'week', 'month', 'quarter', 'year', 'all']).optional().describe('Time period'),
      limit: z.number().min(1).max(50).optional().describe('Number of products to return (max 50)'),
      sort_by: z.enum(['revenue', 'sales']).optional().describe('Sort by revenue or sales count'),
    },
    async ({ period, limit, sort_by }) => {
      const api = getApiClient();
      const result = await api.get<{
        data: {
          products: TopProduct[];
          summary: { total_products: number; total_revenue: number; total_sales: number };
          filters: { period: string; start_date: string; limit: number; sort_by: string };
        };
      }>('/api/v1/analytics/top-products', {
        period,
        limit,
        sort_by,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Get conversion stats (derived from dashboard)
  server.tool(
    'get_conversion_stats',
    'Get conversion statistics including users with access vs total users',
    {},
    async () => {
      const api = getApiClient();
      const result = await api.get<{ data: DashboardData }>('/api/v1/analytics/dashboard');

      const conversionStats = {
        total_users: result.data.users.total,
        users_with_access: result.data.users.with_access,
        conversion_rate:
          result.data.users.total > 0
            ? Math.round((result.data.users.with_access / result.data.users.total) * 10000) / 100
            : 0,
        total_products: result.data.products.total,
        active_products: result.data.products.active,
        product_activation_rate:
          result.data.products.total > 0
            ? Math.round((result.data.products.active / result.data.products.total) * 10000) / 100
            : 0,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(conversionStats, null, 2) }],
      };
    }
  );

  // Get refund stats
  server.tool(
    'get_refund_stats',
    'Get refund statistics including pending requests and total refunded amount',
    {},
    async () => {
      const api = getApiClient();
      const [dashboardResult, statsResult] = await Promise.all([
        api.get<{ data: DashboardData }>('/api/v1/analytics/dashboard'),
        api.get<{ data: PaymentStats }>('/api/v1/payments/stats'),
      ]);

      const refundStats = {
        pending_refund_requests: dashboardResult.data.refunds.pending_count,
        total_refunded: dashboardResult.data.refunds.total_refunded,
        total_revenue: dashboardResult.data.revenue.total,
        net_revenue: dashboardResult.data.revenue.net_revenue,
        refund_rate:
          dashboardResult.data.revenue.total > 0
            ? Math.round(
                (dashboardResult.data.refunds.total_refunded / dashboardResult.data.revenue.total) * 10000
              ) / 100
            : 0,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(refundStats, null, 2) }],
      };
    }
  );

  // Compare periods
  server.tool(
    'compare_periods',
    'Compare revenue and sales between two time periods',
    {
      current_period: z.enum(['day', 'week', 'month', 'quarter', 'year']).describe('Current period to analyze'),
      previous_period: z.enum(['day', 'week', 'month', 'quarter', 'year']).describe('Previous period to compare against'),
    },
    async ({ current_period, previous_period }) => {
      const api = getApiClient();

      // Fetch top products for both periods
      const [currentResult, previousResult] = await Promise.all([
        api.get<{
          data: {
            products: TopProduct[];
            summary: { total_products: number; total_revenue: number; total_sales: number };
          };
        }>('/api/v1/analytics/top-products', {
          period: current_period,
          limit: 50,
        }),
        api.get<{
          data: {
            products: TopProduct[];
            summary: { total_products: number; total_revenue: number; total_sales: number };
          };
        }>('/api/v1/analytics/top-products', {
          period: previous_period,
          limit: 50,
        }),
      ]);

      const current = currentResult.data.summary;
      const previous = previousResult.data.summary;

      const comparison = {
        current_period: {
          period: current_period,
          revenue: current.total_revenue,
          sales: current.total_sales,
          products_sold: current.total_products,
        },
        previous_period: {
          period: previous_period,
          revenue: previous.total_revenue,
          sales: previous.total_sales,
          products_sold: previous.total_products,
        },
        changes: {
          revenue_change: current.total_revenue - previous.total_revenue,
          revenue_change_percent:
            previous.total_revenue > 0
              ? Math.round(((current.total_revenue - previous.total_revenue) / previous.total_revenue) * 10000) /
                100
              : 0,
          sales_change: current.total_sales - previous.total_sales,
          sales_change_percent:
            previous.total_sales > 0
              ? Math.round(((current.total_sales - previous.total_sales) / previous.total_sales) * 10000) / 100
              : 0,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(comparison, null, 2) }],
      };
    }
  );
}
