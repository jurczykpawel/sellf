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
import { replaceEndpointProducts, getEndpointProductIds } from '@/lib/webhooks/endpoint-products';

const PRODUCT_SCOPING_DENIED =
  'Per-product webhook scoping requires a Pro license. Use product_filter_mode="all" or upgrade.';

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
    if (body.product_filter_mode !== undefined) {
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
      updates.product_filter_mode = body.product_filter_mode;
    }

    // If no updates, return current webhook
    if (Object.keys(updates).length === 0) {
      const { data: webhook } = await adminClient
        .from('webhook_endpoints')
        .select('id, url, events, description, is_active, secret, product_filter_mode, created_at, updated_at')
        .eq('id', id)
        .single();

      const product_ids = await getEndpointProductIds(adminClient, id);
      return jsonResponse(successResponse({ ...webhook, product_ids }), request);
    }

    // Update webhook
    updates.updated_at = new Date().toISOString();

    const { data: webhook, error } = await adminClient
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .select('id, url, events, description, is_active, secret, product_filter_mode, created_at, updated_at')
      .single();

    if (error) {
      console.error('Error updating webhook:', error);
      if (error.code === '23505') {
        return apiError(request, 'ALREADY_EXISTS', 'A webhook with this URL already exists');
      }
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update webhook');
    }

    // Rewrite product links when the mode is part of this update.
    if (body.product_filter_mode === 'selected') {
      await replaceEndpointProducts(adminClient, id, Array.from(new Set(body.product_ids ?? [])));
    } else if (body.product_filter_mode === 'all') {
      await replaceEndpointProducts(adminClient, id, []);
    }

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
