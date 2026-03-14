// app/api/admin/payments/export/route.ts
// API endpoint for exporting payment data as CSV

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdminApiWithRequest(request);

    // Use admin client for seller_main data (FK embedding requires correct schema)
    const supabase = createAdminClient();

    // SECURITY: Rate limit export operations (heavy DB queries)
    const rateLimitOk = await checkRateLimit(
      RATE_LIMITS.ADMIN_EXPORT.actionType,
      RATE_LIMITS.ADMIN_EXPORT.maxRequests,
      RATE_LIMITS.ADMIN_EXPORT.windowMinutes,
      user.id
    );

    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 5 exports per hour.' },
        { status: 429 }
      );
    }

    // Get filters from request body
    const filters = await request.json();

    // Build query for transactions
    let query = supabase
      .from('payment_transactions')
      .select(`
        id,
        session_id,
        user_id,
        amount,
        currency,
        status,
        refunded_amount,
        refund_reason,
        created_at,
        updated_at,
        products!inner(name, slug)
      `)
      .order('created_at', { ascending: false });

    // Apply status filter
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    // Apply date range filter
    if (filters.dateRange && filters.dateRange !== 'all') {
      const days = parseInt(filters.dateRange);
      if (!isNaN(days) && days > 0) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        query = query.gte('created_at', startDate.toISOString());
      }
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error('Error fetching transactions for export:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // Convert to CSV
    const csvHeaders = [
      'Transaction ID',
      'Session ID',
      'User ID',
      'Product Name',
      'Product Slug',
      'Amount',
      'Currency',
      'Status',
      'Refunded Amount',
      'Refund Reason',
      'Created At',
      'Updated At'
    ];

    const csvRows = transactions?.map((transaction: Record<string, unknown>) => {
      const products = transaction.products as Record<string, unknown> | Record<string, unknown>[] | null;
      const product = Array.isArray(products) ? products[0] : products;
      return [
        transaction.id,
        transaction.session_id,
        transaction.user_id,
        (product as Record<string, unknown> | null)?.name || '',
        (product as Record<string, unknown> | null)?.slug || '',
        transaction.amount,
        transaction.currency,
        transaction.status,
        transaction.refunded_amount || 0,
        transaction.refund_reason || '',
        new Date(String(transaction.created_at)).toISOString(),
        new Date(String(transaction.updated_at)).toISOString(),
      ];
    }) || [];

    // Sanitize CSV field to prevent formula injection (=, +, -, @, tab, CR)
    const sanitizeCsvField = (field: unknown): string => {
      const str = String(field ?? '');
      const needsPrefix = /^[=+\-@\t\r]/.test(str);
      const sanitized = needsPrefix ? `'${str}` : str;
      if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n'))
        return `"${sanitized.replace(/"/g, '""')}"`;
      return sanitized;
    };

    // Create CSV content
    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row =>
        row.map(sanitizeCsvField).join(',')
      )
    ].join('\n');

    // Return CSV file
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="payments-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Export API error:', error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
