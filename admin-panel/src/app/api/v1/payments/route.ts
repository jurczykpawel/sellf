/**
 * Payments API v1 - List Payments
 *
 * GET /api/v1/payments - List payment transactions with filters and pagination
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
import { parseLimit, applyCursorToQuery, createPaginationResponse, validateCursor } from '@/lib/api/pagination';
import { escapeIlikePattern, validateUUID } from '@/lib/validations/product';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/payments
 *
 * List payment transactions with optional filters.
 *
 * Query params:
 * - cursor: string (pagination cursor)
 * - limit: number (default 50, max 100)
 * - status: 'all' | 'completed' | 'refunded' | 'failed' | 'pending' (default 'all')
 * - product_id: string (filter by product)
 * - email: string (filter by customer email)
 * - date_from: string ISO date (filter from date)
 * - date_to: string ISO date (filter to date)
 * - sort: string (default '-created_at')
 */
export async function GET(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.ANALYTICS_READ]);

    const adminClient = createAdminClient();
    const { searchParams } = request.nextUrl;

    // Parse params
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const status = searchParams.get('status') || 'all';
    const productId = searchParams.get('product_id');
    const email = searchParams.get('email');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const sort = searchParams.get('sort') || '-created_at';

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build query
    let query = adminClient
      .from('payment_transactions')
      .select(`
        id,
        customer_email,
        amount,
        currency,
        status,
        stripe_payment_intent_id,
        product_id,
        products!inner(name, slug),
        user_id,
        session_id,
        refund_id,
        refunded_amount,
        refunded_at,
        refund_reason,
        refunded_by,
        created_at,
        updated_at
      `);

    // Filter by status
    if (status !== 'all') {
      const validStatuses = ['completed', 'refunded', 'failed', 'pending'];
      if (!validStatuses.includes(status)) {
        return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: all, ${validStatuses.join(', ')}`);
      }
      query = query.eq('status', status);
    }

    // Filter by product
    if (productId) {
      const productIdValidation = validateUUID(productId);
      if (!productIdValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid product_id format');
      }
      query = query.eq('product_id', productId);
    }

    // Filter by email (escape ILIKE wildcards to prevent pattern injection)
    if (email) {
      const escapedEmail = escapeIlikePattern(email);
      query = query.ilike('customer_email', `%${escapedEmail}%`);
    }

    // Filter by date range
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      if (!isNaN(fromDate.getTime())) {
        query = query.gte('created_at', fromDate.toISOString());
      }
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      if (!isNaN(toDate.getTime())) {
        query = query.lte('created_at', toDate.toISOString());
      }
    }

    // Sorting
    const isDescending = sort.startsWith('-');
    const sortField = isDescending ? sort.slice(1) : sort;
    const allowedSortFields = ['created_at', 'amount', 'customer_email'];

    if (!allowedSortFields.includes(sortField)) {
      return apiError(request, 'INVALID_INPUT', `Invalid sort field. Allowed: ${allowedSortFields.join(', ')}`);
    }

    const orderDirection = isDescending ? 'desc' : 'asc';

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, sortField, orderDirection);

    query = query
      .order(sortField, { ascending: !isDescending })
      .order('id', { ascending: !isDescending })
      .limit(limit + 1);

    const { data: payments, error } = await query;

    if (error) {
      console.error('Error fetching payments:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payments');
    }

    // Transform response
    const transformedItems = payments.map(p => ({
      id: p.id,
      customer_email: p.customer_email,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      stripe_payment_intent_id: p.stripe_payment_intent_id,
      product: {
        id: p.product_id,
        name: (p.products as { name: string; slug: string })?.name,
        slug: (p.products as { name: string; slug: string })?.slug,
      },
      user_id: p.user_id,
      session_id: p.session_id,
      refund: p.refund_id ? {
        id: p.refund_id,
        amount: p.refunded_amount,
        refunded_at: p.refunded_at,
        reason: p.refund_reason,
        refunded_by: p.refunded_by,
      } : null,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    const { items, pagination } = createPaginationResponse(
      transformedItems,
      limit,
      sortField,
      orderDirection,
      cursor
    );

    return jsonResponse(successResponse(items, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
