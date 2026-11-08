// app/api/admin/payments/stats/route.ts
// API endpoint for payment statistics

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from "@/lib/supabase/admin";

import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { getPaymentStatistics } from '@/lib/payments/statistics';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAdminApiWithRequest(request);

    // Use admin client for public data operations
    const supabase = createAdminClient();

    // SECURITY: Rate limit analytics operations (aggregation queries can be expensive)
    const rateLimitOk = await checkRateLimit(
      RATE_LIMITS.ADMIN_ANALYTICS.actionType,
      RATE_LIMITS.ADMIN_ANALYTICS.maxRequests,
      RATE_LIMITS.ADMIN_ANALYTICS.windowMinutes,
      user.id
    );

    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 30 requests per 5 minutes.' },
        { status: 429 }
      );
    }

    const data = await getPaymentStatistics(supabase);
    const stats = {
      totalTransactions: data.total_transactions,
      totalRevenue: data.total_revenue,
      pendingSessions: 0,
      refundedAmount: data.refunded_amount,
      todayRevenue: data.today_revenue,
      thisMonthRevenue: data.this_month_revenue,
    };

    return NextResponse.json(stats);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Stats API error:', error);
    return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
  }
}
