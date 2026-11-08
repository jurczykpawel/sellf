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

import { getRevenueGroups, countRevenueOrders } from '@/lib/payments/statistics';

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
          startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          groupBy = groupBy || 'day';
          break;
        case 'week':
          startDate = new Date(now);
          startDate.setUTCDate(startDate.getUTCDate() - 7);
          groupBy = groupBy || 'day';
          break;
        case 'month':
          startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          groupBy = groupBy || 'day';
          break;
        case 'quarter':
          startDate = new Date(now);
          startDate.setUTCMonth(startDate.getUTCMonth() - 3);
          groupBy = groupBy || 'week';
          break;
        case 'year':
          startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
          groupBy = groupBy || 'month';
          break;
        case 'all':
          startDate = new Date(Date.UTC(2020, 0, 1)); // Far enough back
          groupBy = groupBy || 'month';
          break;
        default:
          startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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

    const groups = await getRevenueGroups(auth.supabase, { start: startDate, end: endDate, productId });
    const allTx = groups.filter(tx => tx.status !== 'refunded');

    // Calculate summary
    const totalRevenue = allTx.reduce((sum, tx) => sum + tx.amount, 0);
    const totalRefunded = groups.reduce((sum, tx) => sum + (tx.refunded_amount || 0), 0);
    const totalTransactions = countRevenueOrders(allTx);
    const averageOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Group by currency
    const byCurrency = allTx.reduce((acc, tx) => {
      const currency = tx.currency || 'PLN';
      if (!acc[currency]) {
        acc[currency] = { revenue: 0, transactions: 0, refunded: 0 };
      }
      acc[currency].revenue += tx.amount;
      acc[currency].transactions += tx.transaction_count;
      acc[currency].refunded += tx.refunded_amount || 0;
      return acc;
    }, {} as Record<string, { revenue: number; transactions: number; refunded: number }>);

    for (const tx of groups.filter(tx => tx.status === 'refunded')) {
      byCurrency[tx.currency] ??= { revenue: 0, transactions: 0, refunded: 0 };
      byCurrency[tx.currency].refunded += tx.refunded_amount;
    }

    // Generate breakdown by date
    const breakdown: { date: string; revenue: number; transactions: number; by_currency: Record<string, number> }[] = [];

    // Helper to get date key based on groupBy
    const getDateKey = (date: Date): string => {
      switch (groupBy) {
        case 'day':
          return date.toISOString().split('T')[0];
        case 'week':
          const weekStart = new Date(date);
          weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
          return weekStart.toISOString().split('T')[0];
        case 'month':
          return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
          break;
        case 'week':
          currentDate.setUTCDate(currentDate.getUTCDate() + 7);
          break;
        case 'month':
          currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
          break;
        default:
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
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
        transactions: countRevenueOrders(dateTx),
        by_currency: dateByCurrency,
      });
    }

    // Calculate previous period for comparison
    const periodDuration = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - periodDuration);

    const prevTx = (await getRevenueGroups(auth.supabase, { start: prevStartDate, end: prevEndDate, productId })).filter(tx => tx.status !== 'refunded');
    const prevRevenue = prevTx.reduce((sum, tx) => sum + tx.amount, 0);
    const prevTransactionCount = countRevenueOrders(prevTx);

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
          net_revenue: totalRevenue,
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
