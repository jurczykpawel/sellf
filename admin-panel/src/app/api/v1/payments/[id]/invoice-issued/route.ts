/** External invoice issued for a transfer order: the order is held without expiry. @see lib/orders/bank-transfer-admin.ts */
import { authenticate, API_SCOPES, jsonResponse, successResponse, apiError, handleApiError, handleCorsPreFlight } from '@/lib/api';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import type { NextRequest } from 'next/server';
export const OPTIONS = handleCorsPreFlight;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PAYMENTS_WRITE]);
    const { id } = await params;
    const result = await operateTransfer(auth.supabase, auth.admin.userId, id, { action: 'invoice-issued' });
    return result.success ? jsonResponse(successResponse(result), request) : apiError(request, 'VALIDATION_ERROR', result.error!);
  } catch (error) { return handleApiError(error, request); }
}
