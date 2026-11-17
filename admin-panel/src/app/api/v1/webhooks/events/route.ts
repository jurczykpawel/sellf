/**
 * Webhooks API v1 - Abandoned business events
 *
 * GET /api/v1/webhooks/events?status=abandoned
 *   - Requires scope webhooks:read
 *   - Business changes whose hand-off to webhook delivery failed on every attempt
 *     (newest first). The payload is not returned.
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
import { parseLimit } from '@/lib/api/pagination';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_READ]);
    const status = request.nextUrl.searchParams.get('status') ?? 'abandoned';
    if (status !== 'abandoned') return apiError(request, 'INVALID_INPUT', 'Invalid status. Valid values: abandoned');
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));

    const { data, error } = await auth.supabase
      .from('business_events')
      .select('id, event_type, product_id, created_at, attempts, last_error, abandoned_at')
      .is('dispatched_at', null)
      .not('abandoned_at', 'is', null)
      .order('abandoned_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[v1/webhooks/events] List failed:', error.message);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch abandoned events');
    }
    return jsonResponse(successResponse(data ?? []), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
