/**
 * Payments API v1 - Export
 *
 * POST /api/v1/payments/export - Export payment transactions as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreFlight,
  apiError,
  authenticate,
  requireScope,
  handleApiError,
  parseJsonBody,
  API_SCOPES,
  getApiCorsHeaders,
} from '@/lib/api';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { paymentSearchQuery, VALID_PAYMENT_STATUSES } from '@/lib/payments/search';
import { currencyExponent, fromMinorUnits } from '@/lib/currency/minor-units';
import { resolveCurrentTier } from '@/lib/license/resolve';
import { hasFeature } from '@/lib/license/features';
import { buildCsv } from '@/lib/csv/sanitize';

const exportFiltersSchema = z.object({
  status: z.string().optional(),
  searchTerm: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  product_id: z.uuid().optional(),
  date_from: z.string().refine(value => Number.isFinite(Date.parse(value))).optional(),
  date_to: z.string().refine(value => Number.isFinite(Date.parse(value))).optional(),
  dateRange: z.string().refine(value => value === 'all' || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 3650)).optional(),
});

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
 * - search / searchTerm: free-text payment search (max 200 characters)
 * - dateRange: lookback in days, or 'all' (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    requireScope(auth, API_SCOPES.PAYMENTS_READ);

    // CSV export requires at least Registered Free license
    const tier = await resolveCurrentTier();
    if (!hasFeature(tier, 'csv-export')) {
      return apiError(request, 'FORBIDDEN', 'CSV export requires a Sellf license. Register at sellf.app to get a free key.');
    }

    const parsed = exportFiltersSchema.safeParse(await parseJsonBody<unknown>(request));
    if (!parsed.success) return apiError(request, 'INVALID_INPUT', 'Invalid export filters');
    const filters = parsed.data;
    if (filters.status && filters.status !== 'all' && ![...VALID_PAYMENT_STATUSES, 'failed'].includes(filters.status)) {
      return apiError(request, 'INVALID_INPUT', 'Invalid payment status');
    }

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

    const search = filters.search ?? filters.searchTerm ?? '';

    // Build query for transactions
    let query = paymentSearchQuery(auth.supabase, search)
      .select(`
        id,
        session_id,
        user_id,
        customer_email,
        amount,
        currency,
        status,
        net_total,
        tax_total,
        tax_snapshot_status,
        refunded_amount,
        refund_reason,
        created_at,
        updated_at,
        products!inner(name, slug)
      `)
      .order('created_at', { ascending: false }).order('id', { ascending: false });

    if (filters.status && filters.status !== 'all') {
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

    if (filters.product_id) {
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



    const transactions: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await query.range(offset, offset + 999);
      if (error) return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch transactions');
      transactions.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // Convert to CSV
    const csvHeaders = [
      'Transaction ID',
      'Session ID',
      'User ID',
      'Customer Email',
      'Product Name',
      'Product Slug',
      'Amount (major units)',
      'Currency',
      'Net Total (major units)',
      'Tax Total (major units)',
      'Tax Status',
      'Status',
      'Refunded Amount (major units)',
      'Refund Reason',
      'Created At',
      'Updated At'
    ];

    const csvRows = transactions?.map((transaction: Record<string, unknown>) => {
      const products = transaction.products as Record<string, unknown> | Record<string, unknown>[] | null;
      const product = Array.isArray(products) ? products[0] : products;
      const currency = String(transaction.currency);
      const money = (value: unknown) => value == null ? '' : fromMinorUnits(Number(value), currency).toFixed(currencyExponent(currency));
      return [
        transaction.id,
        transaction.session_id || '',
        transaction.user_id || '',
        transaction.customer_email || '',
        (product as Record<string, unknown> | null)?.name || '',
        (product as Record<string, unknown> | null)?.slug || '',
        money(transaction.amount),
        transaction.currency,
        money(transaction.net_total),
        money(transaction.tax_total),
        transaction.tax_snapshot_status ?? '',
        transaction.status,
        money(transaction.refunded_amount ?? 0),
        transaction.refund_reason || '',
        new Date(String(transaction.created_at)).toISOString(),
        new Date(String(transaction.updated_at)).toISOString(),
      ];
    }) || [];

    const csvContent = buildCsv(csvHeaders, csvRows);

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
