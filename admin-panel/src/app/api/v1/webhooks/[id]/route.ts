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
import { createAdminClient } from '@/lib/supabase/admin';
import { validateUUID } from '@/lib/validations/product';
import { isValidWebhookUrl, validateEventTypes } from '@/lib/validations/webhook';

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
    await authenticate(request, [API_SCOPES.WEBHOOKS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const adminClient = createAdminClient();

    const { data: webhook, error } = await adminClient
      .from('webhook_endpoints')
      .select(`
        id,
        url,
        events,
        description,
        is_active,
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

    return jsonResponse(successResponse(webhook), request);
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
    await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const adminClient = createAdminClient();

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
    }>(request);

    const updates: Record<string, unknown> = {};

    // Validate and set URL if provided
    if (body.url !== undefined) {
      const urlValidation = isValidWebhookUrl(body.url);
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

    // If no updates, return current webhook
    if (Object.keys(updates).length === 0) {
      const { data: webhook } = await adminClient
        .from('webhook_endpoints')
        .select('id, url, events, description, is_active, created_at, updated_at')
        .eq('id', id)
        .single();

      return jsonResponse(successResponse(webhook), request);
    }

    // Update webhook
    updates.updated_at = new Date().toISOString();

    const { data: webhook, error } = await adminClient
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .select('id, url, events, description, is_active, created_at, updated_at')
      .single();

    if (error) {
      console.error('Error updating webhook:', error);
      if (error.code === '23505') {
        return apiError(request, 'ALREADY_EXISTS', 'A webhook with this URL already exists');
      }
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update webhook');
    }

    return jsonResponse(successResponse(webhook), request);
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
    await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const adminClient = createAdminClient();

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
