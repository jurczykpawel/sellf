/**
 * Payments API v1 - Statistics
 *
 * GET /api/v1/payments/stats - Get payment statistics
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
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/payments/stats
 *
 * Get payment statistics including total revenue, transaction counts, etc.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);

    // Rate limit analytics operations (aggregation queries can be expensive)
    // Get user ID from auth result for rate limiting
    const userId = authResult.method === 'session' ? authResult.admin.userId : authResult.apiKey?.id;

    if (userId) {
      const rateLimitOk = await checkRateLimit(
        RATE_LIMITS.ADMIN_ANALYTICS.actionType,
        RATE_LIMITS.ADMIN_ANALYTICS.maxRequests,
        RATE_LIMITS.ADMIN_ANALYTICS.windowMinutes,
        userId
      );

      if (!rateLimitOk) {
        return apiError(request, 'RATE_LIMITED', 'Rate limit exceeded. Maximum 30 requests per 5 minutes.');
      }
    }

    const adminClient = createAdminClient();

    // Calculate date ranges
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get total transactions count
    const { count: totalTransactions } = await adminClient
      .from('payment_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed');

    // Get total revenue (with currency for breakdown)
    const { data: revenueData } = await adminClient
      .from('payment_transactions')
      .select('amount, currency')
      .eq('status', 'completed');

    const totalRevenue = revenueData?.reduce((sum, transaction) => sum + transaction.amount, 0) || 0;

    // Build by_currency breakdown
    const byCurrency: Record<string, { total_revenue: number; transaction_count: number }> = {};
    for (const t of revenueData || []) {
      const cur = t.currency || 'USD';
      if (!byCurrency[cur]) {
        byCurrency[cur] = { total_revenue: 0, transaction_count: 0 };
      }
      byCurrency[cur].total_revenue += t.amount;
      byCurrency[cur].transaction_count += 1;
    }

    // Get refunded amount
    const { data: refundData } = await adminClient
      .from('payment_transactions')
      .select('refunded_amount')
      .gt('refunded_amount', 0);

    const refundedAmount = refundData?.reduce((sum, transaction) => sum + (transaction.refunded_amount || 0), 0) || 0;

    // Get today's revenue
    const { data: todayRevenueData } = await adminClient
      .from('payment_transactions')
      .select('amount')
      .eq('status', 'completed')
      .gte('created_at', todayStart.toISOString());

    const todayRevenue = todayRevenueData?.reduce((sum, transaction) => sum + transaction.amount, 0) || 0;

    // Get this month's revenue
    const { data: monthRevenueData } = await adminClient
      .from('payment_transactions')
      .select('amount')
      .eq('status', 'completed')
      .gte('created_at', monthStart.toISOString());

    const thisMonthRevenue = monthRevenueData?.reduce((sum, transaction) => sum + transaction.amount, 0) || 0;

    // Get pending transactions count
    const { count: pendingCount } = await adminClient
      .from('payment_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const stats = {
      total_transactions: totalTransactions || 0,
      total_revenue: totalRevenue,
      pending_count: pendingCount || 0,
      refunded_amount: refundedAmount,
      today_revenue: todayRevenue,
      this_month_revenue: thisMonthRevenue,
      by_currency: byCurrency,
    };

    return jsonResponse(successResponse(stats), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
