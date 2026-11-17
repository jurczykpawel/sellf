/**
 * Webhooks API v1 - Retry an abandoned business event
 *
 * POST /api/v1/webhooks/events/:eventId/retry
 *   - Requires an admin session
 *   - Only an abandoned event is eligible; it gets fresh attempts and is due on the
 *     worker's next tick.
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
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

interface RouteParams {
  params: Promise<{ eventId: string }>;
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
    const { eventId } = await params;
    if (!validateUUID(eventId).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid event ID format');

    const { data, error } = await supabase.rpc('retry_business_event', { p_id: eventId });
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
