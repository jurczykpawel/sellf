/**
 * Payments API v1 - Statistics
 *
 * GET /api/v1/payments/stats - Get payment statistics
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
import { getPaymentStatistics } from '@/lib/payments/statistics';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/payments/stats
 *
 * Get payment statistics including total revenue, transaction counts, etc.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);

    // Rate limit analytics operations (aggregation queries can be expensive)
    // Get user ID from auth result for rate limiting
    const userId = authResult.method === 'session' ? authResult.admin.userId : authResult.apiKey?.id;

    if (userId) {
      const rateLimitOk = await checkRateLimit(
        RATE_LIMITS.ADMIN_ANALYTICS.actionType,
        RATE_LIMITS.ADMIN_ANALYTICS.maxRequests,
        RATE_LIMITS.ADMIN_ANALYTICS.windowMinutes,
        userId
      );

      if (!rateLimitOk) {
        return apiError(request, 'RATE_LIMITED', 'Rate limit exceeded. Maximum 30 requests per 5 minutes.');
      }
    }

    const stats = await getPaymentStatistics(authResult.supabase);

    return jsonResponse(successResponse(stats), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
