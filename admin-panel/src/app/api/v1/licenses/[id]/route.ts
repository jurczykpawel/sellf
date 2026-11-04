/**
 * Licenses API v1 (Pro) — read one (with token) and revoke.
 *
 * GET    /api/v1/licenses/:id — licenses:read; includes the signed token
 * DELETE /api/v1/licenses/:id — licenses:write; permanent revocation (same path as the admin panel), emits license.revoked
 */
import { NextRequest } from 'next/server';
import { API_SCOPES, apiError, authenticate, handleApiError, handleCorsPreFlight, jsonResponse, successResponse } from '@/lib/api';
import { LICENSE_API_FIELDS, toLicenseApiView, type LicenseApiRow } from '@/lib/license-keys/api-view';
import { checkFeature } from '@/lib/license/resolve';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCanonicalOrigin } from '@/lib/utils/canonical-url';
import { validateUUID } from '@/lib/validations/product';

const FEATURE_DENIED = 'License issuance requires a Pro license';
type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

async function load(id: string) {
  return createAdminClient().from('issued_licenses').select(`${LICENSE_API_FIELDS}, license_key`).eq('id', id).maybeSingle();
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    await authenticate(request, [API_SCOPES.LICENSES_READ]);
    if (!(await checkFeature('license-key-issuance', { dataClient: createAdminClient() }))) return apiError(request, 'FORBIDDEN', FEATURE_DENIED);
    const { id } = await params;
    if (!validateUUID(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid license ID format');
    const { data, error } = await load(id);
    if (error) return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch license');
    if (!data) return apiError(request, 'NOT_FOUND', 'License not found');
    return jsonResponse(successResponse(toLicenseApiView(data as unknown as LicenseApiRow, getCanonicalOrigin(request))), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const auth = await authenticate(request, [API_SCOPES.LICENSES_WRITE]);
    const admin = createAdminClient();
    if (!(await checkFeature('license-key-issuance', { dataClient: admin }))) return apiError(request, 'FORBIDDEN', FEATURE_DENIED);
    const { id } = await params;
    if (!validateUUID(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid license ID format');
    const { data, error } = await admin.rpc('revoke_issued_licenses', { p_license_ids: [id], p_actor: auth.admin.userId, p_reason: 'manual' });
    if (error) return apiError(request, 'INTERNAL_ERROR', 'License revocation failed');
    if (!data?.length) return apiError(request, 'NOT_FOUND', 'License not found');
    return jsonResponse(successResponse({ id, revoked: true }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
