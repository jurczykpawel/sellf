/**
 * Webhooks API v1 - Test Webhook
 *
 * POST /api/v1/webhooks/:id/test - Send a test webhook to an endpoint
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
import { validateUUID } from '@/lib/validations/product';
import { WebhookService } from '@/lib/services/webhook-service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * POST /api/v1/webhooks/:id/test
 *
 * Send a test webhook to an endpoint.
 *
 * Request body (optional):
 * - event_type: string - Event type to test (default: first event in endpoint's events array)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const { data: webhook, error: fetchError } = await adminClient
      .from('webhook_endpoints')
      .select('id, url, events, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !webhook) {
      return apiError(request, 'NOT_FOUND', 'Webhook not found');
    }

    // Parse optional event type from body
    let eventType: string | undefined;
    try {
      const body = await request.json();
      eventType = body.event_type;
    } catch {
      // Empty body is OK
    }

    // Send test webhook
    const result = await WebhookService.testEndpoint(id, eventType);

    return jsonResponse(
      successResponse({
        success: result.success,
        http_status: result.status,
        error: result.error,
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
