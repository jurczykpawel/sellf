/**
 * Webhooks API v1 - Retry Webhook Delivery
 *
 * POST /api/v1/webhooks/logs/:logId/retry - Retry a failed webhook delivery
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
  params: Promise<{ logId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * POST /api/v1/webhooks/logs/:logId/retry
 *
 * Retry a failed webhook delivery.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { logId } = await params;

    // Validate ID format
    const idValidation = validateUUID(logId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');
    }

    // Check log exists
    const { data: log, error: fetchError } = await auth.supabase
      .from('webhook_logs')
      .select('id, status')
      .eq('id', logId)
      .single();

    if (fetchError || !log) {
      return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    }

    // Only allow retrying failed logs
    if (log.status !== 'failed') {
      return apiError(
        request,
        'INVALID_INPUT',
        `Cannot retry webhook with status '${log.status}'. Only failed webhooks can be retried.`
      );
    }

    // Retry the webhook
    const result = await WebhookService.retry(logId);

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
