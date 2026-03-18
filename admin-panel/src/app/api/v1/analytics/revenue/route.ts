/**
 * Analytics API v1 - Revenue Statistics
 *
 * GET /api/v1/analytics/revenue - Get detailed revenue statistics
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
 * GET /api/v1/analytics/revenue
 *
 * Get detailed revenue statistics for a time period.
 *
 * Query params:
 * - period: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all' (default 'month')
 * - start_date: string ISO date (optional, overrides period)
 * - end_date: string ISO date (optional)
 * - product_id: string (optional) - Filter by product
 * - group_by: 'day' | 'week' | 'month' (default based on period)
 *
 * Returns:
 * - summary: total_revenue, total_transactions, average_order_value, by_currency
 * - breakdown: array of { date, revenue, transactions, by_currency }
 * - comparison: previous period comparison (percentage change)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);
    const { searchParams } = request.nextUrl;

    const period = searchParams.get('period') || 'month';
    const startDateParam = searchParams.get('start_date');
    const endDateParam = searchParams.get('end_date');
    const productId = searchParams.get('product_id');
    let groupBy = searchParams.get('group_by');

    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;
    const endDate = endDateParam ? new Date(endDateParam) : now;

    if (startDateParam) {
      startDate = new Date(startDateParam);
    } else {
      switch (period) {
        case 'day':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          groupBy = groupBy || 'day';
          break;
        case 'week':
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 7);
          groupBy = groupBy || 'day';
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          groupBy = groupBy || 'day';
          break;
        case 'quarter':
          startDate = new Date(now);
          startDate.setMonth(startDate.getMonth() - 3);
          groupBy = groupBy || 'week';
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          groupBy = groupBy || 'month';
          break;
        case 'all':
          startDate = new Date(2020, 0, 1); // Far enough back
          groupBy = groupBy || 'month';
          break;
        default:
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          groupBy = groupBy || 'day';
      }
    }

    // Validate dates
    if (isNaN(startDate.getTime())) {
      return apiError(request, 'INVALID_INPUT', 'Invalid start_date format');
    }
    if (isNaN(endDate.getTime())) {
      return apiError(request, 'INVALID_INPUT', 'Invalid end_date format');
    }

    // Fetch transactions for the period
    let query = auth.supabase
      .from('payment_transactions')
      .select('amount, currency, created_at, refunded_amount, product_id')
      .eq('status', 'completed')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data: transactions, error: txError } = await query;

    if (txError) {
      console.error('Error fetching transactions:', txError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch transaction data');
    }

    const allTx = transactions || [];

    // Calculate summary
    const totalRevenue = allTx.reduce((sum, tx) => sum + tx.amount, 0);
    const totalRefunded = allTx.reduce((sum, tx) => sum + (tx.refunded_amount || 0), 0);
    const totalTransactions = allTx.length;
    const averageOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Group by currency
    const byCurrency = allTx.reduce((acc, tx) => {
      const currency = tx.currency || 'PLN';
      if (!acc[currency]) {
        acc[currency] = { revenue: 0, transactions: 0, refunded: 0 };
      }
      acc[currency].revenue += tx.amount;
      acc[currency].transactions += 1;
      acc[currency].refunded += tx.refunded_amount || 0;
      return acc;
    }, {} as Record<string, { revenue: number; transactions: number; refunded: number }>);

    // Generate breakdown by date
    const breakdown: { date: string; revenue: number; transactions: number; by_currency: Record<string, number> }[] = [];

    // Helper to get date key based on groupBy
    const getDateKey = (date: Date): string => {
      switch (groupBy) {
        case 'day':
          return date.toISOString().split('T')[0];
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          return weekStart.toISOString().split('T')[0];
        case 'month':
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        default:
          return date.toISOString().split('T')[0];
      }
    };

    // Group transactions by date
    const byDate = new Map<string, typeof allTx>();
    for (const tx of allTx) {
      const key = getDateKey(new Date(tx.created_at));
      if (!byDate.has(key)) {
        byDate.set(key, []);
      }
      byDate.get(key)!.push(tx);
    }

    // Generate all date keys in range (to include zero-days)
    const allDateKeys = new Set<string>();
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      allDateKeys.add(getDateKey(currentDate));
      switch (groupBy) {
        case 'day':
          currentDate.setDate(currentDate.getDate() + 1);
          break;
        case 'week':
          currentDate.setDate(currentDate.getDate() + 7);
          break;
        case 'month':
          currentDate.setMonth(currentDate.getMonth() + 1);
          break;
        default:
          currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // Build breakdown with all dates
    for (const dateKey of Array.from(allDateKeys).sort()) {
      const dateTx = byDate.get(dateKey) || [];
      const dateByCurrency = dateTx.reduce((acc, tx) => {
        const currency = tx.currency || 'PLN';
        acc[currency] = (acc[currency] || 0) + tx.amount;
        return acc;
      }, {} as Record<string, number>);

      breakdown.push({
        date: dateKey,
        revenue: dateTx.reduce((sum, tx) => sum + tx.amount, 0),
        transactions: dateTx.length,
        by_currency: dateByCurrency,
      });
    }

    // Calculate previous period for comparison
    const periodDuration = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - periodDuration);

    let prevQuery = auth.supabase
      .from('payment_transactions')
      .select('amount')
      .eq('status', 'completed')
      .gte('created_at', prevStartDate.toISOString())
      .lte('created_at', prevEndDate.toISOString());

    if (productId) {
      prevQuery = prevQuery.eq('product_id', productId);
    }

    const { data: prevTransactions } = await prevQuery;
    const prevTx = prevTransactions || [];
    const prevRevenue = prevTx.reduce((sum, tx) => sum + tx.amount, 0);
    const prevTransactionCount = prevTx.length;

    const revenueChange = prevRevenue > 0
      ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
      : totalRevenue > 0 ? 100 : 0;

    const transactionChange = prevTransactionCount > 0
      ? ((totalTransactions - prevTransactionCount) / prevTransactionCount) * 100
      : totalTransactions > 0 ? 100 : 0;

    return jsonResponse(
      successResponse({
        summary: {
          total_revenue: totalRevenue,
          total_refunded: totalRefunded,
          net_revenue: totalRevenue - totalRefunded,
          total_transactions: totalTransactions,
          average_order_value: Math.round(averageOrderValue * 100) / 100,
          by_currency: byCurrency,
        },
        breakdown,
        comparison: {
          previous_period: {
            start: prevStartDate.toISOString(),
            end: prevEndDate.toISOString(),
            revenue: prevRevenue,
            transactions: prevTransactionCount,
          },
          revenue_change_percent: Math.round(revenueChange * 100) / 100,
          transaction_change_percent: Math.round(transactionChange * 100) / 100,
        },
        filters: {
          period,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          product_id: productId,
          group_by: groupBy,
        },
        generated_at: new Date().toISOString(),
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
