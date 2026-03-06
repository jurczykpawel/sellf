/**
 * Webhooks API v1 - List and Create Webhooks
 *
 * GET /api/v1/webhooks - List webhook endpoints
 * POST /api/v1/webhooks - Create a new webhook endpoint
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidWebhookUrl, validateEventTypes } from '@/lib/validations/webhook';
import { parseLimit, applyCursorToQuery, createPaginationResponse, validateCursor } from '@/lib/api/pagination';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/webhooks
 *
 * List all webhook endpoints.
 *
 * Query params:
 * - cursor: string (pagination cursor)
 * - limit: number (default 50, max 100)
 * - status: 'all' | 'active' | 'inactive' (default 'all')
 */
export async function GET(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.WEBHOOKS_READ]);

    const adminClient = createAdminClient();
    const { searchParams } = request.nextUrl;

    // Parse params
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const status = searchParams.get('status') || 'all';

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build query
    let query = adminClient
      .from('webhook_endpoints')
      .select(`
        id,
        url,
        events,
        description,
        is_active,
        created_at,
        updated_at
      `);

    // Filter by status
    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    }

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, 'created_at', 'desc');

    // Sort and limit
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const { data: webhooks, error } = await query;

    if (error) {
      console.error('Error fetching webhooks:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch webhooks');
    }

    const { items, pagination } = createPaginationResponse(
      webhooks as { id: string }[],
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

/**
 * POST /api/v1/webhooks
 *
 * Create a new webhook endpoint.
 *
 * Request body:
 * - url: string (required) - Webhook URL (must be HTTPS)
 * - events: string[] (required) - List of event types to subscribe to
 * - description: string (optional) - Description of the webhook
 * - is_active: boolean (optional, default true) - Whether the webhook is active
 */
export async function POST(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);

    const adminClient = createAdminClient();

    const body = await parseJsonBody<{
      url?: string;
      events?: string[];
      description?: string;
      is_active?: boolean;
    }>(request);

    const { url, events, description, is_active = true } = body;

    // Validate required fields
    if (!url) {
      return apiError(request, 'INVALID_INPUT', 'URL is required');
    }

    if (!events) {
      return apiError(request, 'INVALID_INPUT', 'Events array is required');
    }

    // Validate URL (SSRF protection)
    const urlValidation = isValidWebhookUrl(url);
    if (!urlValidation.valid) {
      return apiError(request, 'INVALID_INPUT', urlValidation.error || 'Invalid webhook URL');
    }

    // Validate events
    const eventsValidation = validateEventTypes(events);
    if (!eventsValidation.valid) {
      return apiError(request, 'INVALID_INPUT', eventsValidation.error || 'Invalid event types');
    }

    // Validate description length
    if (description && description.length > 500) {
      return apiError(request, 'INVALID_INPUT', 'Description must be 500 characters or less');
    }

    // Create webhook
    const { data: webhook, error } = await adminClient
      .from('webhook_endpoints')
      .insert({
        url,
        events,
        description: description || null,
        is_active,
      })
      .select('id, url, events, description, is_active, secret, created_at, updated_at')
      .single();

    if (error) {
      console.error('Error creating webhook:', error);
      if (error.code === '23505') {
        return apiError(request, 'ALREADY_EXISTS', 'A webhook with this URL already exists');
      }
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create webhook');
    }

    return jsonResponse(
      successResponse({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        description: webhook.description,
        is_active: webhook.is_active,
        secret: webhook.secret,
        created_at: webhook.created_at,
        updated_at: webhook.updated_at,
      }),
      request,
      201
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
