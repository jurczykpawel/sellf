/**
 * Webhooks API v1 - Replay a permanently_failed delivery
 *
 * POST /api/v1/webhooks/logs/:logId/replay
 *   - Requires an admin session
 *   - Only valid for status='permanently_failed' rows
 *   - Resets attempt_count to 0 and schedules immediate retry by the worker
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
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';

interface RouteParams {
  params: Promise<{ logId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) {
      return apiError(request, 'FORBIDDEN', 'Manual delivery operations require an admin session');
    }
    await requireAdminApi(await createClient(), request);
    const supabase = createAdminClient();
    const { logId } = await params;

    const idCheck = validateUUID(logId);
    if (!idCheck.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');
    }

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

    if (log.status !== 'permanently_failed') {
      return apiError(
        request,
        'CONFLICT',
        `Cannot replay a delivery with status '${log.status}'. Only permanently_failed deliveries can be replayed.`,
      );
    }

    const queue = new SupabaseWebhookQueue(supabase);
    await queue.replay(logId);

    return jsonResponse(successResponse({ status: 'enqueued' }), request);
  } catch (error) {
    if (error instanceof Error && error.message === 'Endpoint URL changed') return apiError(request, 'CONFLICT', error.message);
    return handleApiError(error, request);
  }
}
