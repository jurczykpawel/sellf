/**
 * Webhooks API v1 - Single Webhook Operations
 *
 * GET /api/v1/webhooks/:id - Get webhook details
 * PATCH /api/v1/webhooks/:id - Update webhook
 * DELETE /api/v1/webhooks/:id - Delete webhook
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  noContentResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { validateWebhookUrlAsync, validateEventTypes, validateProductFilter } from '@/lib/validations/webhook';
import { checkFeature } from '@/lib/license/resolve';
import { setEndpointScoping, getEndpointProductIds } from '@/lib/webhooks/endpoint-products';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';

const PRODUCT_SCOPING_DENIED =
  'Per-product webhook scoping requires a Pro license. Use product_filter_mode="all" or upgrade.';

const PAYLOAD_CUSTOMIZATION_FEATURE = 'webhook-payload-customization' as const;
const PAYLOAD_CUSTOMIZATION_ERROR = 'Custom headers/fields/selection require a Pro license.';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/webhooks/:id
 *
 * Get details of a specific webhook endpoint.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const adminClient = auth.supabase;

    const { data: webhook, error } = await adminClient
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
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Webhook not found');
      }
      console.error('Error fetching webhook:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch webhook');
    }

    const product_ids = await getEndpointProductIds(adminClient, id);
    return jsonResponse(successResponse({ ...webhook, product_ids }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/webhooks/:id
 *
 * Update a webhook endpoint.
 *
 * Request body (all optional):
 * - url: string - Webhook URL
 * - events: string[] - Event types to subscribe to
 * - description: string - Description
 * - is_active: boolean - Active status
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const adminClient = auth.supabase;

    // Check webhook exists
    const { data: existing, error: fetchError } = await adminClient
      .from('webhook_endpoints')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return apiError(request, 'NOT_FOUND', 'Webhook not found');
    }

    const body = await parseJsonBody<{
      url?: string;
      events?: string[];
      description?: string;
      is_active?: boolean;
      product_filter_mode?: string;
      product_ids?: string[];
      custom_headers?: Record<string, string>;
      custom_payload_fields?: Record<string, unknown>;
      payload_field_selection?: string[];
    }>(request);

    const updates: Record<string, unknown> = {};

    // Validate and set URL if provided
    if (body.url !== undefined) {
      const urlValidation = await validateWebhookUrlAsync(body.url);
      if (!urlValidation.valid) {
        return apiError(request, 'INVALID_INPUT', urlValidation.error || 'Invalid webhook URL');
      }
      updates.url = body.url;
    }

    // Validate and set events if provided
    if (body.events !== undefined) {
      const eventsValidation = validateEventTypes(body.events);
      if (!eventsValidation.valid) {
        return apiError(request, 'INVALID_INPUT', eventsValidation.error || 'Invalid event types');
      }
      updates.events = body.events;
    }

    // Set description if provided (with length limit)
    if (body.description !== undefined) {
      if (body.description && body.description.length > 500) {
        return apiError(request, 'INVALID_INPUT', 'Description must be 500 characters or less');
      }
      updates.description = body.description || null;
    }

    // Set is_active if provided
    if (typeof body.is_active === 'boolean') {
      updates.is_active = body.is_active;
    }

    // Product scoping: product_ids are only meaningful alongside an explicit mode.
    if (body.product_ids !== undefined && body.product_filter_mode === undefined) {
      return apiError(request, 'INVALID_INPUT', 'product_ids requires product_filter_mode');
    }
    const scopingChange = body.product_filter_mode !== undefined;
    let scopedLinks: string[] = [];
    if (scopingChange) {
      const filterValidation = validateProductFilter(body.product_filter_mode, body.product_ids);
      if (!filterValidation.valid) {
        return apiError(request, 'INVALID_INPUT', filterValidation.error || 'Invalid product filter');
      }
      if (
        body.product_filter_mode === 'selected' &&
        !(await checkFeature('webhook-product-scoping', { dataClient: adminClient }))
      ) {
        return apiError(request, 'FORBIDDEN', PRODUCT_SCOPING_DENIED);
      }
      scopedLinks =
        body.product_filter_mode === 'selected' ? Array.from(new Set(body.product_ids ?? [])) : [];
    }

    // Payload customization (custom headers/fields/field selection) is a Pro feature.
    const hasCustomization =
      body.custom_headers !== undefined ||
      body.custom_payload_fields !== undefined ||
      body.payload_field_selection !== undefined;
    if (hasCustomization && !(await checkFeature(PAYLOAD_CUSTOMIZATION_FEATURE, { dataClient: adminClient }))) {
      return apiError(request, 'FORBIDDEN', PAYLOAD_CUSTOMIZATION_ERROR);
    }
    if (body.custom_headers !== undefined) {
      updates.custom_headers_encrypted =
        body.custom_headers && Object.keys(body.custom_headers).length > 0
          ? await encryptHeaderMap(body.custom_headers)
          : null;
    }
    if (body.custom_payload_fields !== undefined) {
      updates.custom_payload_fields = body.custom_payload_fields ?? null;
    }
    if (body.payload_field_selection !== undefined) {
      updates.payload_field_selection = body.payload_field_selection ?? null;
    }

    // Nothing to change
    if (Object.keys(updates).length === 0 && !scopingChange) {
      const { data: webhook } = await adminClient
        .from('webhook_endpoints')
        .select('id, url, events, description, is_active, secret, product_filter_mode, created_at, updated_at')
        .eq('id', id)
        .single();

      const product_ids = await getEndpointProductIds(adminClient, id);
      return jsonResponse(successResponse({ ...webhook, product_ids }), request);
    }

    // Apply non-scoping field updates (url/events/description/is_active).
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await adminClient
        .from('webhook_endpoints')
        .update(updates)
        .eq('id', id);

      if (error) {
        console.error('Error updating webhook:', error);
        if (error.code === '23505') {
          return apiError(request, 'ALREADY_EXISTS', 'A webhook with this URL already exists');
        }
        return apiError(request, 'INTERNAL_ERROR', 'Failed to update webhook');
      }
    }

    // Apply scoping (mode + links) atomically in one transaction.
    if (scopingChange) {
      try {
        await setEndpointScoping(
          adminClient,
          id,
          body.product_filter_mode as 'all' | 'selected',
          scopedLinks,
        );
      } catch (scopingError) {
        console.error('Error scoping webhook products:', scopingError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to set webhook product scope');
      }
    }

    const { data: webhook } = await adminClient
      .from('webhook_endpoints')
      .select('id, url, events, description, is_active, secret, product_filter_mode, created_at, updated_at')
      .eq('id', id)
      .single();
    const product_ids = await getEndpointProductIds(adminClient, id);
    return jsonResponse(successResponse({ ...webhook, product_ids }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/webhooks/:id
 *
 * Delete a webhook endpoint.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const adminClient = auth.supabase;

    // Check webhook exists
    const { data: existing, error: fetchError } = await adminClient
      .from('webhook_endpoints')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return apiError(request, 'NOT_FOUND', 'Webhook not found');
    }

    // Delete webhook
    const { error } = await adminClient
      .from('webhook_endpoints')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting webhook:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete webhook');
    }

    // Return 204 No Content on successful deletion
    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
