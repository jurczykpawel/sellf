/**
 * Analytics API v1 - Top Products
 *
 * GET /api/v1/analytics/top-products - Get best selling products
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/analytics/top-products
 *
 * Get best selling products ranked by revenue or sales count.
 *
 * Query params:
 * - period: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all' (default 'month')
 * - limit: number (default 10, max 50)
 * - sort_by: 'revenue' | 'sales' (default 'revenue')
 *
 * Returns:
 * - products: array of { product_id, name, slug, revenue, sales_count, average_price, by_currency }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);
    const { searchParams } = request.nextUrl;

    const period = searchParams.get('period') || 'month';
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);
    const sortBy = searchParams.get('sort_by') || 'revenue';

    if (!['revenue', 'sales'].includes(sortBy)) {
      return apiError(request, 'INVALID_INPUT', 'sort_by must be "revenue" or "sales"');
    }

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all':
        startDate = new Date(2020, 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get transactions with product info
    const { data: transactions, error: txError } = await auth.supabase
      .from('payment_transactions')
      .select('product_id, amount, currency')
      .eq('status', 'completed')
      .gte('created_at', startDate.toISOString());

    if (txError) {
      console.error('Error fetching transactions:', txError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch transaction data');
    }

    // Aggregate by product
    const productStats = new Map<string, {
      revenue: number;
      sales_count: number;
      by_currency: Record<string, { revenue: number; count: number }>;
    }>();

    for (const tx of transactions || []) {
      if (!tx.product_id) continue;

      if (!productStats.has(tx.product_id)) {
        productStats.set(tx.product_id, {
          revenue: 0,
          sales_count: 0,
          by_currency: {},
        });
      }

      const stats = productStats.get(tx.product_id)!;
      stats.revenue += tx.amount;
      stats.sales_count += 1;

      const currency = tx.currency || 'PLN';
      if (!stats.by_currency[currency]) {
        stats.by_currency[currency] = { revenue: 0, count: 0 };
      }
      stats.by_currency[currency].revenue += tx.amount;
      stats.by_currency[currency].count += 1;
    }

    // Get product details
    const productIds = Array.from(productStats.keys());

    if (productIds.length === 0) {
      return jsonResponse(
        successResponse({
          products: [],
          filters: { period, limit, sort_by: sortBy },
          generated_at: new Date().toISOString(),
        }),
        request
      );
    }

    const { data: products, error: prodError } = await auth.supabase
      .from('products')
      .select('id, name, slug, price, currency, is_active')
      .in('id', productIds);

    if (prodError) {
      console.error('Error fetching products:', prodError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch product data');
    }

    // Build result
    const productMap = new Map(products?.map(p => [p.id, p]) || []);

    const result = Array.from(productStats.entries())
      .map(([productId, stats]) => {
        const product = productMap.get(productId);
        return {
          product_id: productId,
          name: product?.name || 'Unknown Product',
          slug: product?.slug || '',
          is_active: product?.is_active ?? false,
          current_price: product?.price || 0,
          current_currency: product?.currency || 'PLN',
          revenue: stats.revenue,
          sales_count: stats.sales_count,
          average_price: stats.sales_count > 0
            ? Math.round((stats.revenue / stats.sales_count) * 100) / 100
            : 0,
          by_currency: stats.by_currency,
        };
      })
      .sort((a, b) => sortBy === 'revenue'
        ? b.revenue - a.revenue
        : b.sales_count - a.sales_count
      )
      .slice(0, limit);

    // Calculate totals
    const totalRevenue = result.reduce((sum, p) => sum + p.revenue, 0);
    const totalSales = result.reduce((sum, p) => sum + p.sales_count, 0);

    return jsonResponse(
      successResponse({
        products: result.map((p, index) => ({
          ...p,
          rank: index + 1,
          revenue_share: totalRevenue > 0
            ? Math.round((p.revenue / totalRevenue) * 10000) / 100
            : 0,
          sales_share: totalSales > 0
            ? Math.round((p.sales_count / totalSales) * 10000) / 100
            : 0,
        })),
        summary: {
          total_products: result.length,
          total_revenue: totalRevenue,
          total_sales: totalSales,
        },
        filters: {
          period,
          start_date: startDate.toISOString(),
          limit,
          sort_by: sortBy,
        },
        generated_at: new Date().toISOString(),
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
