/**
 * GET /api/v1/payments/:id/late-transfer-preview — read-only facts before accepting a transfer that arrived after the
 * order was cancelled (W254b): order price vs today's, seats left in the session and in the saved price tier, whether
 * acceptance goes over a limit (then mark-paid needs acceptOversold: true), coupon state, corrected invoice.
 * No personal data. @see lib/orders/late-transfer-preview.ts, ../mark-paid/route.ts
 */
import { authenticate, API_SCOPES, jsonResponse, successResponse, apiError, handleApiError, handleCorsPreFlight } from '@/lib/api';
import { previewLateTransfer } from '@/lib/orders/late-transfer-preview';
import { validateUUID } from '@/lib/validations/product';
import type { NextRequest } from 'next/server';
export const OPTIONS = handleCorsPreFlight;
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PAYMENTS_READ]);
    const { id } = await params;
    if (!validateUUID(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid payment ID format');
    const preview = await previewLateTransfer(auth.supabase, id, new Date());
    return preview ? jsonResponse(successResponse(preview), request) : apiError(request, 'NOT_FOUND', 'No cancelled bank transfer order with this ID');
  } catch (error) { return handleApiError(error, request); }
}
