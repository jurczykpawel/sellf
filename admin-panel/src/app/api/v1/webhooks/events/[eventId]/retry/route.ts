/**
 * Webhooks API v1 - Retry an abandoned business event
 *
 * POST /api/v1/webhooks/events/:eventId/retry
 *   - Requires scope webhooks:write
 *   - Only an abandoned event is eligible; it gets fresh attempts and is due on the
 *     worker's next tick.
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
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

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { eventId } = await params;
    if (!validateUUID(eventId).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid event ID format');

    const { data, error } = await auth.supabase.rpc('retry_business_event', { p_id: eventId });
    if (error) {
      console.error('[v1/webhooks/events/retry] Retry failed:', error.message);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to retry the event');
    }
    if (!data) return apiError(request, 'CONFLICT', 'Only an abandoned event can be retried');
    return jsonResponse(successResponse({ status: 'rescheduled' }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
