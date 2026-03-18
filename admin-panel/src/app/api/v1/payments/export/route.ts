/**
 * Payments API v1 - Export
 *
 * POST /api/v1/payments/export - Export payment transactions as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  handleCorsPreFlight,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  API_SCOPES,
  getApiCorsHeaders,
} from '@/lib/api';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { validateUUID } from '@/lib/validations/product';
import { getCurrentTier, hasFeature } from '@/lib/license/features';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * POST /api/v1/payments/export
 *
 * Export payment transactions as CSV.
 *
 * Body:
 * - status: 'all' | 'completed' | 'refunded' | 'failed' | 'pending' (default: 'all')
 * - date_from: ISO date string (optional)
 * - date_to: ISO date string (optional)
 * - product_id: UUID (optional)
 */
export async function POST(request: NextRequest) {
  try {
    // CSV export requires at least Registered Free license
    const tier = getCurrentTier();
    if (!hasFeature(tier, 'csv-export')) {
      return apiError(request, 'FORBIDDEN', 'CSV export requires a Sellf license. Register at sellf.app to get a free key.');
    }

    const auth = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);

    // Rate limit export operations (heavy DB queries)
    const userId = auth.method === 'session' ? auth.admin.userId : auth.apiKey?.id;

    if (userId) {
      const rateLimitOk = await checkRateLimit(
        RATE_LIMITS.ADMIN_EXPORT.actionType,
        RATE_LIMITS.ADMIN_EXPORT.maxRequests,
        RATE_LIMITS.ADMIN_EXPORT.windowMinutes,
        userId
      );

      if (!rateLimitOk) {
        return apiError(request, 'RATE_LIMITED', 'Rate limit exceeded. Maximum 5 exports per hour.');
      }
    }

    const filters = await parseJsonBody<{
      status?: string;
      date_from?: string;
      date_to?: string;
      product_id?: string;
      dateRange?: string;
    }>(request);

    // Build query for transactions
    let query = auth.supabase
      .from('payment_transactions')
      .select(`
        id,
        session_id,
        user_id,
        customer_email,
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

    // Apply status filter (validate against whitelist)
    if (filters.status && filters.status !== 'all') {
      const validStatuses = ['completed', 'refunded', 'failed', 'pending'];
      if (!validStatuses.includes(filters.status)) {
        return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: all, ${validStatuses.join(', ')}`);
      }
      query = query.eq('status', filters.status);
    }

    // Apply date range filter
    if (filters.date_from) {
      const fromDate = new Date(filters.date_from);
      if (!isNaN(fromDate.getTime())) {
        query = query.gte('created_at', fromDate.toISOString());
      }
    }

    if (filters.date_to) {
      const toDate = new Date(filters.date_to);
      if (!isNaN(toDate.getTime())) {
        query = query.lte('created_at', toDate.toISOString());
      }
    }

    // Apply product filter
    if (filters.product_id) {
      const idValidation = validateUUID(filters.product_id);
      if (!idValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
      }
      query = query.eq('product_id', filters.product_id);
    }

    // Legacy support: dateRange as number of days (max 3650 = ~10 years)
    if (filters.dateRange && filters.dateRange !== 'all' && !filters.date_from) {
      const days = parseInt(filters.dateRange);
      if (!isNaN(days) && days > 0 && days <= 3650) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        query = query.gte('created_at', startDate.toISOString());
      }
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error('Error fetching transactions for export:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch transactions');
    }

    // Convert to CSV
    const csvHeaders = [
      'Transaction ID',
      'Session ID',
      'User ID',
      'Customer Email',
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
        transaction.session_id || '',
        transaction.user_id || '',
        transaction.customer_email || '',
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

    // Return CSV file with CORS headers
    const origin = request.headers.get('origin');
    const corsHeaders = getApiCorsHeaders(origin);
    return new NextResponse(csvContent, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payments-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}
