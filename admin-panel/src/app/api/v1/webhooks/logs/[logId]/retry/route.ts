/**
 * Webhooks API v1 - Retry Webhook Delivery
 *
 * POST /api/v1/webhooks/logs/:logId/retry - Retry a failed webhook delivery
 */

import { NextRequest } from 'next/server';
import { requireAdminApi } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  handleApiError,
  successResponse,
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
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) {
      return apiError(request, 'FORBIDDEN', 'Manual delivery operations require an admin session');
    }
    await requireAdminApi(await createClient(), request);
    const supabase = createAdminClient();
    const { logId } = await params;

    // Validate ID format
    const idValidation = validateUUID(logId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');
    }

    // Check log exists
    const { data: log, error: fetchError } = await supabase
      .from('webhook_logs')
      .select('id, status')
      .eq('id', logId)
      .single();

    if (fetchError || !log) {
      return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    }

    const target = await supabase.rpc('check_webhook_delivery_target', { p_id: logId });
    if (target.error?.code === 'PT409') return apiError(request, 'CONFLICT', 'Endpoint URL changed; this delivery cannot be retried');
    if (target.error) return apiError(request, 'INTERNAL_ERROR', 'Delivery target unavailable');

    // Only allow retrying failed logs
    if (log.status !== 'failed') {
      return apiError(
        request,
        'INVALID_INPUT',
        `Cannot retry webhook with status '${log.status}'. Only failed webhooks can be retried.`
      );
    }

    // Retry the webhook
    const result = await WebhookService.retry(logId, supabase);

    return jsonResponse(
      successResponse({
        success: result.success,
        http_status: result.status,
        error: result.error,
      }),
      request
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Endpoint URL changed') return apiError(request, 'CONFLICT', error.message);
    return handleApiError(error, request);
  }
}
