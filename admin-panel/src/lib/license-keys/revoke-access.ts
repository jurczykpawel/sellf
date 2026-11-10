/** Shared v1 access revocation, by access ID or selected product. */
import type { NextRequest, NextResponse } from 'next/server';
import { authenticate, API_SCOPES, apiError, handleApiError, jsonResponse, successResponse, noContentResponse } from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { accessActor, mutateAccess } from '@/lib/services/business-events';
import { canManageAccessLicense } from '@/lib/license-keys/access';

export async function revokeUserAccess(request: NextRequest, userId: string, accessId?: string): Promise<NextResponse> {
  try {
    const auth = await authenticate(request, [API_SCOPES.USERS_WRITE]);
    const productId = request.nextUrl.searchParams.get('product_id');
    const target = accessId ?? productId;
    if (!validateUUID(userId).isValid || !target || !validateUUID(target).isValid) {
      return apiError(request, 'INVALID_INPUT', 'Valid user and access or product IDs are required');
    }
    const choice = request.nextUrl.searchParams.get('revoke_license');
    if (choice !== null && choice !== 'true' && choice !== 'false') return apiError(request, 'VALIDATION_ERROR', 'Invalid revoke_license');
    let query = auth.supabase.from('user_product_access').select('id, product_id').eq('user_id', userId);
    query = accessId ? query.eq('id', accessId) : query.eq('product_id', productId!);
    const found = await query.single();
    if (found.error || !found.data) return apiError(request, 'NOT_FOUND', 'Access entry not found');
    const allowed = canManageAccessLicense(auth.scopes);
    const revokeLicense = choice !== 'false' && allowed;
    const linked = !allowed && choice !== 'false'
      ? await auth.supabase.from('issued_licenses').select('id').eq('access_grant_id', found.data.id).is('revoked_at', null).maybeSingle()
      : { data: null, error: null };
    if (linked.error) return apiError(request, 'INTERNAL_ERROR', 'Failed to check the access license');
    const result = await mutateAccess(auth.supabase, 'revoke', userId, accessActor(auth), { revoke_license: revokeLicense }, found.data.id);
    if (result.error) return apiError(request, 'INTERNAL_ERROR', 'Failed to revoke access and its license');
    if (linked.data && choice !== 'false' && !allowed) {
      return jsonResponse(successResponse({ access_revoked: true, license_warning: 'License retained: licenses:write scope required' }), request);
    }
    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
