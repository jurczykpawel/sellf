/**
 * Webhooks API v1 - Replay a permanently_failed delivery
 *
 * POST /api/v1/webhooks/logs/:logId/replay
 *   - Requires scope webhooks:write
 *   - Only valid for status='permanently_failed' rows
 *   - Resets attempt_count to 0 and schedules immediate retry by the worker
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

    if (log.status !== 'permanently_failed') {
      return apiError(
        request,
        'CONFLICT',
        `Cannot replay a delivery with status '${log.status}'. Only permanently_failed deliveries can be replayed.`,
      );
    }

    const queue = new SupabaseWebhookQueue(auth.supabase);
    await queue.replay(logId);

    return jsonResponse(successResponse({ status: 'enqueued' }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
