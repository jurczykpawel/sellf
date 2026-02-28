/**
 * Webhooks API v1 - Archive Webhook Log
 *
 * POST /api/v1/webhooks/logs/[logId]/archive - Archive a webhook log
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
import { createAdminClient } from '@/lib/supabase/admin';
import { validateUUID } from '@/lib/validations/product';

interface RouteContext {
  params: Promise<{ logId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * POST /api/v1/webhooks/logs/[logId]/archive
 *
 * Archive a webhook log entry.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);

    const { logId } = await context.params;

    const idValidation = validateUUID(logId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');
    }

    const adminClient = createAdminClient();

    // Check if log exists
    const { data: existingLog, error: fetchError } = await adminClient
      .from('webhook_logs')
      .select('id, status')
      .eq('id', logId)
      .single();

    if (fetchError || !existingLog) {
      return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    }

    // Update status to archived
    const { error } = await adminClient
      .from('webhook_logs')
      .update({ status: 'archived' })
      .eq('id', logId);

    if (error) {
      console.error('Failed to archive webhook log:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to archive webhook log');
    }

    return jsonResponse(successResponse({ archived: true }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
