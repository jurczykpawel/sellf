/**
 * Analytics API v1 - Dashboard Overview
 *
 * GET /api/v1/analytics/dashboard - Get dashboard overview with key metrics
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
 * GET /api/v1/analytics/dashboard
 *
 * Get dashboard overview with key metrics.
 *
 * Query params:
 * - product_id: string (optional) - Filter stats by product
 *
 * Returns:
 * - revenue: today, this_week, this_month, total, by_currency
 * - transactions: today, this_week, this_month, total
 * - products: active, total
 * - users: total, with_access
 * - refunds: pending_count, total_amount
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);

    const adminClient = auth.supabase;
    const { searchParams } = request.nextUrl;
    const productId = searchParams.get('product_id');

    // Calculate date ranges
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Build base query for transactions
    const buildTransactionQuery = () => {
      let query = adminClient
        .from('payment_transactions')
        .select('amount, currency, created_at, refunded_amount')
        .eq('status', 'completed');

      if (productId) {
        query = query.eq('product_id', productId);
      }

      return query;
    };

    // Get all completed transactions
    const { data: transactions, error: txError } = await buildTransactionQuery();

    if (txError) {
      console.error('Error fetching transactions:', txError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch transaction data');
    }

    const allTx = transactions || [];

    // Calculate revenue metrics
    const todayTx = allTx.filter(tx => new Date(tx.created_at) >= todayStart);
    const weekTx = allTx.filter(tx => new Date(tx.created_at) >= weekStart);
    const monthTx = allTx.filter(tx => new Date(tx.created_at) >= monthStart);

    const sumAmount = (txList: typeof allTx) => txList.reduce((sum, tx) => sum + tx.amount, 0);

    // Group by currency
    const byCurrency = allTx.reduce((acc, tx) => {
      const currency = tx.currency || 'PLN';
      acc[currency] = (acc[currency] || 0) + tx.amount;
      return acc;
    }, {} as Record<string, number>);

    // Get refund data
    const totalRefunded = allTx.reduce((sum, tx) => sum + (tx.refunded_amount || 0), 0);

    // Get pending refund requests
    const { count: pendingRefunds } = await adminClient
      .from('refund_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Get product counts
    const { count: totalProducts } = await adminClient
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { count: activeProducts } = await adminClient
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Get user counts from user_access_stats view
    const { count: totalUsers } = await adminClient
      .from('user_access_stats')
      .select('*', { count: 'exact', head: true });

    // Count users with at least one product access
    const { data: usersWithAccess } = await adminClient
      .from('user_access_stats')
      .select('user_id, total_products')
      .gt('total_products', 0);

    const uniqueUsersWithAccess = usersWithAccess?.length || 0;

    // Get recent activity (last 7 days transactions count per day)
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentActivity = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(todayStart);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayTx = allTx.filter(tx => {
        const txDate = new Date(tx.created_at);
        return txDate >= date && txDate < nextDate;
      });

      recentActivity.push({
        date: date.toISOString().split('T')[0],
        transactions: dayTx.length,
        revenue: sumAmount(dayTx),
      });
    }

    return jsonResponse(
      successResponse({
        revenue: {
          today: sumAmount(todayTx),
          this_week: sumAmount(weekTx),
          this_month: sumAmount(monthTx),
          total: sumAmount(allTx),
          total_refunded: totalRefunded,
          net_revenue: sumAmount(allTx) - totalRefunded,
          by_currency: byCurrency,
        },
        transactions: {
          today: todayTx.length,
          this_week: weekTx.length,
          this_month: monthTx.length,
          total: allTx.length,
        },
        products: {
          active: activeProducts || 0,
          total: totalProducts || 0,
        },
        users: {
          total: totalUsers || 0,
          with_access: uniqueUsersWithAccess,
        },
        refunds: {
          pending_count: pendingRefunds || 0,
          total_refunded: totalRefunded,
        },
        recent_activity: recentActivity,
        generated_at: new Date().toISOString(),
        filters: {
          product_id: productId,
        },
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
