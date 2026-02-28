/**
 * Refund Requests API v1 - List Refund Requests
 *
 * GET /api/v1/refund-requests - List all refund requests
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
import { validateProductId, validateUUID } from '@/lib/validations/product';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/refund-requests
 *
 * List all refund requests with filters.
 *
 * Query params:
 * - cursor: string (pagination cursor)
 * - limit: number (default 50, max 100)
 * - status: 'all' | 'pending' | 'approved' | 'rejected' (default 'all')
 * - user_id: string (filter by user)
 * - product_id: string (filter by product)
 */
export async function GET(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.REFUND_REQUESTS_READ]);

    const adminClient = createAdminClient();
    const { searchParams } = request.nextUrl;

    // Parse params
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const status = searchParams.get('status') || 'all';
    const userId = searchParams.get('user_id');
    const productId = searchParams.get('product_id');

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build query
    let query = adminClient
      .from('refund_requests')
      .select(`
        id,
        user_id,
        product_id,
        transaction_id,
        customer_email,
        requested_amount,
        currency,
        reason,
        status,
        admin_response,
        processed_at,
        created_at,
        updated_at,
        product:products (
          id,
          name,
          slug
        ),
        transaction:payment_transactions (
          id,
          customer_email,
          amount,
          currency,
          created_at
        )
      `);

    // Filter by status
    if (status !== 'all') {
      const validStatuses = ['pending', 'approved', 'rejected'];
      if (validStatuses.includes(status)) {
        query = query.eq('status', status);
      } else {
        return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: ${validStatuses.join(', ')}`);
      }
    }

    // Filter by user
    if (userId) {
      const userIdValidation = validateUUID(userId);
      if (!userIdValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid user_id format');
      }
      query = query.eq('user_id', userId);
    }

    // Filter by product
    if (productId) {
      const productIdValidation = validateProductId(productId);
      if (!productIdValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid product_id format');
      }
      query = query.eq('product_id', productId);
    }

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, 'created_at', 'desc');

    // Sort and limit
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const { data: requests, error } = await query;

    if (error) {
      console.error('Error fetching refund requests:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch refund requests');
    }

    // Transform response
    const transformedItems = requests.map(req => ({
      id: req.id,
      user_id: req.user_id,
      product_id: req.product_id,
      transaction_id: req.transaction_id,
      customer_email: req.customer_email,
      requested_amount: req.requested_amount,
      currency: req.currency,
      reason: req.reason,
      status: req.status,
      admin_response: req.admin_response,
      processed_at: req.processed_at,
      created_at: req.created_at,
      updated_at: req.updated_at,
      product: req.product ? {
        id: (req.product as any).id,
        name: (req.product as any).name,
        slug: (req.product as any).slug,
      } : null,
      transaction: req.transaction ? {
        id: (req.transaction as any).id,
        customer_email: (req.transaction as any).customer_email,
        amount: (req.transaction as any).amount,
        currency: (req.transaction as any).currency,
        created_at: (req.transaction as any).created_at,
      } : null,
    }));

    const { items, pagination } = createPaginationResponse(
      transformedItems,
      limit,
      'created_at',
      'desc',
      cursor
    );

    return jsonResponse(successResponse(items, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
