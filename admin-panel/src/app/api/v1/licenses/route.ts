/**
 * Licenses API v1 (Pro) — list and issue.
 *
 * GET  /api/v1/licenses — cursor list; filters: product_id, email, status (active|expired|revoked), source (purchase|manual|api)
 * POST /api/v1/licenses — issue { productId, email, domain?, customFieldValues?, sendEmail? (default true), locale? }
 *
 * Issuance emits license.issued; the buyer receives the key by mail unless sendEmail is false.
 * @see src/lib/license-keys/request.ts
 */
import { NextRequest } from 'next/server';
import {
  API_SCOPES, apiError, authenticate, handleApiError, handleCorsPreFlight, jsonResponse, parseJsonBody, successResponse,
} from '@/lib/api';
import { applyCursorToQuery, createPaginationResponse, parseLimit, validateCursor } from '@/lib/api/pagination';
import { LICENSE_API_FIELDS, toLicenseApiView, type LicenseApiRow } from '@/lib/license-keys/api-view';
import { issueRequestedLicense, licenseRequestSchema } from '@/lib/license-keys/request';
import { checkFeature } from '@/lib/license/resolve';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCanonicalOrigin } from '@/lib/utils/canonical-url';
import { validateUUID } from '@/lib/validations/product';

const FEATURE_DENIED = 'License issuance requires a Pro license';
const STATUSES = ['active', 'expired', 'revoked'];
const SOURCES = ['purchase', 'manual', 'api'];

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.LICENSES_READ]);
    const admin = createAdminClient();
    if (!(await checkFeature('license-key-issuance', { dataClient: admin }))) return apiError(request, 'FORBIDDEN', FEATURE_DENIED);
    const { searchParams } = request.nextUrl;
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const productId = searchParams.get('product_id');
    const email = searchParams.get('email');
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const cursorError = validateCursor(cursor);
    if (cursorError) return apiError(request, 'INVALID_INPUT', cursorError);
    if (productId && !validateUUID(productId).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid product_id');
    if (email && (email.length > 254 || !email.includes('@'))) return apiError(request, 'INVALID_INPUT', 'Invalid email');
    if (status && !STATUSES.includes(status)) return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: ${STATUSES.join(', ')}`);
    if (source && !SOURCES.includes(source)) return apiError(request, 'INVALID_INPUT', `Invalid source. Valid values: ${SOURCES.join(', ')}`);

    const now = new Date().toISOString();
    let query = admin.from('issued_licenses').select(LICENSE_API_FIELDS);
    if (productId) query = query.eq('product_id', productId);
    if (email) query = query.ilike('email', email.replace(/[%_\\]/g, '\\$&'));
    if (source) query = query.eq('issuance_source', source);
    if (status === 'revoked') query = query.not('revoked_at', 'is', null);
    if (status === 'expired') query = query.is('revoked_at', null).lte('expires_at', now);
    if (status === 'active') query = query.is('revoked_at', null).or(`expires_at.is.null,expires_at.gt.${now}`);
    query = applyCursorToQuery(query, cursor, 'issued_at', 'desc');
    const { data, error } = await query.order('issued_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (error) {
      console.error('[v1/licenses] List failed:', error.message);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch licenses');
    }
    const { items, pagination } = createPaginationResponse((data ?? []) as unknown as (LicenseApiRow & Record<string, unknown>)[], limit, 'issued_at', 'desc', cursor);
    const origin = getCanonicalOrigin(request);
    return jsonResponse(successResponse(items.map(row => toLicenseApiView(row, origin)), pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.LICENSES_WRITE]);
    const admin = createAdminClient();
    if (!(await checkFeature('license-key-issuance', { dataClient: admin }))) return apiError(request, 'FORBIDDEN', FEATURE_DENIED);
    const actorKey = auth.method === 'api_key' ? auth.apiKey.id : auth.admin.userId;
    if (!(await checkRateLimit('v1_license_issue', 30, 1, actorKey))) return apiError(request, 'RATE_LIMITED', 'Too many license issuance requests');
    const parsed = licenseRequestSchema.safeParse(await parseJsonBody<unknown>(request));
    if (!parsed.success) return apiError(request, 'VALIDATION_ERROR', 'Invalid request', parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const origin = getCanonicalOrigin(request);
    const issued = await issueRequestedLicense(parsed.data, { actorUserId: auth.admin.userId, source: 'api', origin });
    if (!issued.ok) {
      if (issued.status === 409) return apiError(request, 'CONFLICT', issued.error);
      if (issued.status === 400) return apiError(request, 'VALIDATION_ERROR', issued.error, issued.fieldErrors && Object.fromEntries(Object.entries(issued.fieldErrors).map(([k, v]) => [k, [v]])));
      return apiError(request, 'INTERNAL_ERROR', issued.error);
    }
    const row = await admin.from('issued_licenses').select(`${LICENSE_API_FIELDS}, license_key`).eq('id', issued.license.id).single();
    if (row.error || !row.data) return apiError(request, 'INTERNAL_ERROR', 'License issued but could not be read back');
    return jsonResponse(successResponse({ ...toLicenseApiView(row.data as unknown as LicenseApiRow, origin), emailSent: issued.license.emailSent }), request, 201);
  } catch (error) {
    return handleApiError(error, request);
  }
}
