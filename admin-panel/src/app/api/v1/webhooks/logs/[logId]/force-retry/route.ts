/**
 * Webhooks API v1 - Force a pending_retry delivery to run now
 *
 * POST /api/v1/webhooks/logs/:logId/force-retry
 *   - Requires scope webhooks:write
 *   - Only valid for status='pending_retry' rows
 *   - Sets next_retry_at = NOW() so the worker picks it on its next tick
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
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';

interface RouteParams {
  params: Promise<{ logId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { logId } = await params;

    const idCheck = validateUUID(logId);
    if (!idCheck.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');
    }

    const { data: log, error: fetchError } = await auth.supabase
      .from('webhook_logs')
      .select('id, status')
      .eq('id', logId)
      .single();

    if (fetchError || !log) {
      return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    }

    if (log.status !== 'pending_retry') {
      return apiError(
        request,
        'CONFLICT',
        `Cannot force-retry a delivery with status '${log.status}'. Only pending_retry deliveries are eligible.`,
      );
    }

    const queue = new SupabaseWebhookQueue(auth.supabase);
    await queue.forceRetryNow(logId);

    return jsonResponse(successResponse({ status: 'rescheduled' }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
