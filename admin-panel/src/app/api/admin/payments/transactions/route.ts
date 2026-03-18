// app/api/admin/payments/transactions/route.ts
// API endpoint for fetching payment transactions

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

import { requireAdminOrSellerApi } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dateRange = searchParams.get('dateRange');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100'), 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

    // Use adminClient (seller_main schema) for FK embedding queries —
    // PostgREST can't resolve FK relationships through proxy views in public schema.
    const adminClient = await createDataClientFromAuth(authResult.sellerSchema);
    let query = adminClient
      .from('payment_transactions')
      .select(`
        *,
        products!inner(name, slug)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply status filter
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Apply date range filter
    if (dateRange && dateRange !== 'all') {
      const days = parseInt(dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      query = query.gte('created_at', startDate.toISOString());
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error('Error fetching transactions:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    return NextResponse.json(transactions || []);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
