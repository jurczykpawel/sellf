/**
 * Analytics API v1 - Purchase attribution
 *
 * GET /api/v1/analytics/attribution — where purchases came from, aggregated (no personal data).
 *
 * Query params:
 * - days: number (default 30) — or from / to (ISO dates)
 * - touch: 'last' (default) | 'first'
 * - group_by: CSV of channel, source, medium, campaign, content, term, referrer_host, landing_path,
 *   product, country, device_class, affiliate, kind, day (default channel,source,medium,campaign,content)
 * - product_id: uuid (optional)
 *
 * Returns rows of { <dimensions>, currency, orders, paid_orders, free_orders, customers, gross,
 * refunded, net, net_per_customer, avg_days_to_purchase }. Amounts in major units, net of refunds
 * (a disputed payment counts as fully refunded). Per-order detail: GET /api/v1/payments?embed=attribution.
 *
 * @see src/lib/attribution/report.ts
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
import { parseAttributionQuery } from '@/lib/attribution/report';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);
    const parsed = parseAttributionQuery(request.nextUrl.searchParams);
    if (!parsed.ok) return apiError(request, 'INVALID_INPUT', parsed.error);
    const q = parsed.value;

    const { data, error } = await auth.supabase.rpc('get_attribution_report', {
      p_from: q.from.toISOString(),
      p_to: q.to.toISOString(),
      p_touch: q.touch,
      p_group_by: q.groupBy,
      ...(q.productId ? { p_product: q.productId } : {}),
    });
    if (error) {
      console.error('[GET /api/v1/analytics/attribution] Error:', error.message);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to build attribution report');
    }

    return jsonResponse(successResponse({
      rows: Array.isArray(data) ? data : [],
      filters: {
        from: q.from.toISOString(),
        to: q.to.toISOString(),
        touch: q.touch,
        group_by: q.groupBy,
        product_id: q.productId,
      },
      generated_at: new Date().toISOString(),
    }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
