/**
 * Webhooks API v1 - Webhook Delivery Logs
 *
 * GET /api/v1/webhooks/logs - List webhook delivery logs
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
import { parseLimit, applyCursorToQuery, createPaginationResponse, validateCursor } from '@/lib/api/pagination';
import { validateUUID } from '@/lib/validations/product';
import { isValidEventType } from '@/lib/validations/webhook';

interface WebhookEndpointRelation {
  id: string;
  url: string;
  description: string | null;
  is_active: boolean;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/webhooks/logs
 *
 * List webhook delivery logs with filters.
 *
 * Query params:
 * - cursor: string (pagination cursor)
 * - limit: number (default 50, max 100)
 * - endpoint_id: string (filter by webhook endpoint)
 * - status: 'all' | 'success' | 'failed' | 'archived' | 'retried' (default 'all')
 * - event_type: string (filter by event type)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_READ]);

    const adminClient = auth.supabase;
    const { searchParams } = request.nextUrl;

    // Parse params
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const endpointId = searchParams.get('endpoint_id');
    const status = searchParams.get('status') || 'all';
    const eventType = searchParams.get('event_type');

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build query
    let query = adminClient
      .from('webhook_logs')
      .select(`
        id,
        endpoint_id,
        event_type,
        payload,
        http_status,
        response_body,
        error_message,
        duration_ms,
        status,
        created_at,
        endpoint:webhook_endpoints (
          id,
          url,
          description,
          is_active
        )
      `);

    // Filter by endpoint (validate UUID format)
    if (endpointId) {
      const idValidation = validateUUID(endpointId);
      if (!idValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid endpoint_id format');
      }
      query = query.eq('endpoint_id', endpointId);
    }

    // Filter by status
    if (status !== 'all') {
      const validStatuses = ['success', 'failed', 'archived', 'retried'];
      if (validStatuses.includes(status)) {
        query = query.eq('status', status);
      } else {
        return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: ${validStatuses.join(', ')}`);
      }
    }

    // Filter by event type (validate against whitelist)
    if (eventType) {
      if (!isValidEventType(eventType)) {
        return apiError(request, 'INVALID_INPUT', 'Invalid event_type filter');
      }
      query = query.eq('event_type', eventType);
    }

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, 'created_at', 'desc');

    // Sort and limit
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const { data: logs, error } = await query;

    if (error) {
      console.error('Error fetching webhook logs:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch webhook logs');
    }

    // Transform response
    const transformedItems = logs.map(log => ({
      id: log.id,
      endpoint_id: log.endpoint_id,
      endpoint: log.endpoint ? (() => {
        const e = log.endpoint as unknown as WebhookEndpointRelation;
        return { id: e.id, url: e.url, description: e.description, is_active: e.is_active };
      })() : null,
      event_type: log.event_type,
      payload: log.payload,
      http_status: log.http_status,
      response_body: log.response_body,
      error_message: log.error_message,
      duration_ms: log.duration_ms,
      status: log.status,
      created_at: log.created_at,
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
