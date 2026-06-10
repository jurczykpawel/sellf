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
import { validateWebhookUrlAsync, validateEventTypes, validateProductFilter } from '@/lib/validations/webhook';
import { parseLimit, applyCursorToQuery, createPaginationResponse, validateCursor } from '@/lib/api/pagination';
import { checkFeature } from '@/lib/license/resolve';
import { setEndpointScoping, getEndpointProductIdsMap } from '@/lib/webhooks/endpoint-products';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';

const WEBHOOK_ENDPOINT_QUOTA = 50;

const PRODUCT_SCOPING_FEATURE = 'webhook-product-scoping' as const;
const PRODUCT_SCOPING_DENIED =
  'Per-product webhook scoping requires a Pro license. Use product_filter_mode="all" or upgrade.';

const PAYLOAD_CUSTOMIZATION_FEATURE = 'webhook-payload-customization' as const;
const PAYLOAD_CUSTOMIZATION_ERROR = 'Custom headers/fields/selection require a Pro license.';

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
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_READ]);

    const adminClient = auth.supabase;
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
        secret,
        product_filter_mode,
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

    const productMap = await getEndpointProductIdsMap(
      adminClient,
      (items as Array<{ id: string }>).map((w) => w.id),
    );
    const itemsWithProducts = (items as Array<{ id: string }>).map((w) => ({
      ...w,
      product_ids: productMap[w.id] ?? [],
    }));

    return jsonResponse(successResponse(itemsWithProducts, pagination), request);
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
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);

    const adminClient = auth.supabase;

    const body = await parseJsonBody<{
      url?: string;
      events?: string[];
      description?: string;
      is_active?: boolean;
      product_filter_mode?: string;
      product_ids?: string[];
    }>(request);

    const { url, events, description, is_active = true, product_filter_mode, product_ids } = body;
    const { custom_headers, custom_payload_fields, payload_field_selection } = body as {
      custom_headers?: Record<string, string>;
      custom_payload_fields?: Record<string, unknown>;
      payload_field_selection?: string[];
    };

    // Validate required fields
    if (!url) {
      return apiError(request, 'INVALID_INPUT', 'URL is required');
    }

    if (!events) {
      return apiError(request, 'INVALID_INPUT', 'Events array is required');
    }

    // Validate URL (SSRF protection — sync hostname checks + DNS resolution)
    const urlValidation = await validateWebhookUrlAsync(url);
    if (!urlValidation.valid) {
      return apiError(request, 'INVALID_INPUT', urlValidation.error || 'Invalid webhook URL');
    }

    // Validate events
    const eventsValidation = validateEventTypes(events);
    if (!eventsValidation.valid) {
      return apiError(request, 'INVALID_INPUT', eventsValidation.error || 'Invalid event types');
    }

    // Validate product scoping
    const filterValidation = validateProductFilter(product_filter_mode, product_ids);
    if (!filterValidation.valid) {
      return apiError(request, 'INVALID_INPUT', filterValidation.error || 'Invalid product filter');
    }

    // Per-product scoping is a Pro feature; 'all' (the default) stays free.
    const scoped = product_filter_mode === 'selected';
    if (scoped && !(await checkFeature(PRODUCT_SCOPING_FEATURE, { dataClient: adminClient }))) {
      return apiError(request, 'FORBIDDEN', PRODUCT_SCOPING_DENIED);
    }

    // Payload customization (custom headers/fields/field selection) is a Pro feature.
    const hasCustomization =
      custom_headers != null || custom_payload_fields != null || payload_field_selection != null;
    if (hasCustomization && !(await checkFeature(PAYLOAD_CUSTOMIZATION_FEATURE, { dataClient: adminClient }))) {
      return apiError(request, 'FORBIDDEN', PAYLOAD_CUSTOMIZATION_ERROR);
    }
    const custom_headers_encrypted =
      custom_headers && Object.keys(custom_headers).length > 0
        ? await encryptHeaderMap(custom_headers)
        : null;

    // Validate description length
    if (description && description.length > 500) {
      return apiError(request, 'INVALID_INPUT', 'Description must be 500 characters or less');
    }

    // Per-tenant quota — prevents an API key from filling the endpoints table
    // and starving the WebhookService dispatcher with thousands of subscribers.
    const { count: existing, error: countError } = await adminClient
      .from('webhook_endpoints')
      .select('id', { count: 'exact', head: true });
    if (countError) {
      console.error('Error counting webhook endpoints:', countError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to validate webhook quota');
    }
    if ((existing ?? 0) >= WEBHOOK_ENDPOINT_QUOTA) {
      return apiError(
        request,
        'CONFLICT',
        `Webhook endpoint quota reached (${WEBHOOK_ENDPOINT_QUOTA}). Delete unused endpoints before creating a new one.`,
      );
    }

    // Create the endpoint as 'all'; promote to 'selected' atomically below so a
    // scoping failure never leaves a half-created 'selected'+no-links endpoint.
    const { data: webhook, error } = await adminClient
      .from('webhook_endpoints')
      .insert({
        url,
        events,
        description: description || null,
        is_active,
        custom_headers_encrypted,
        custom_payload_fields: custom_payload_fields ?? null,
        payload_field_selection: payload_field_selection ?? null,
      })
      .select('id, url, events, description, is_active, secret, product_filter_mode, created_at, updated_at')
      .single();

    if (error) {
      console.error('Error creating webhook:', error);
      if (error.code === '23505') {
        return apiError(request, 'ALREADY_EXISTS', 'A webhook with this URL already exists');
      }
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create webhook');
    }

    const linkedProductIds = scoped ? Array.from(new Set(product_ids ?? [])) : [];
    if (scoped) {
      try {
        await setEndpointScoping(adminClient, webhook.id, 'selected', linkedProductIds);
      } catch (scopingError) {
        console.error('Error scoping webhook products:', scopingError);
        // TODO: fold create+scoping into one transactional RPC to drop this best-effort cleanup
        await adminClient.from('webhook_endpoints').delete().eq('id', webhook.id);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to set webhook product scope');
      }
    }

    return jsonResponse(
      successResponse({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        description: webhook.description,
        is_active: webhook.is_active,
        secret: webhook.secret,
        product_filter_mode: scoped ? 'selected' : webhook.product_filter_mode,
        product_ids: linkedProductIds,
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
