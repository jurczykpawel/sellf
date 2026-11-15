/** Transfer administration. @see lib/orders/bank-transfer-admin.ts */
import { authenticate, API_SCOPES, parseJsonBody, jsonResponse, successResponse, apiError, handleApiError, handleCorsPreFlight } from '@/lib/api';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import type { NextRequest } from 'next/server';
export const OPTIONS = handleCorsPreFlight;
const CONFLICT_CODES = new Set(['oversold_confirmation_required']);
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PAYMENTS_WRITE]);
    const { id } = await params;
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const result = await operateTransfer(auth.supabase, auth.admin.userId, id, { ...body, action: 'mark-paid' });
    if (result.success) return jsonResponse(successResponse(result), request);
    // details.code names the refusal. Over the seat limit the request is valid but conflicts with the current state:
    // 409, resend with acceptOversold: true (W254c). Every other refusal is a validation error.
    const status = result.code && CONFLICT_CODES.has(result.code) ? 'CONFLICT' : 'VALIDATION_ERROR';
    return apiError(request, status, result.error!, result.code ? { code: [result.code] } : undefined);
  } catch (error) { return handleApiError(error, request); }
}
