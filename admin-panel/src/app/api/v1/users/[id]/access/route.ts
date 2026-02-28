/**
 * Users API v1 - User Access Management
 *
 * GET /api/v1/users/:id/access - List user's product access
 * POST /api/v1/users/:id/access - Grant user access to a product
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  ApiValidationError,
  successResponse,
  parseLimit,
  createPaginationResponse,
  applyCursorToQuery,
  validateCursor,
  API_SCOPES,
} from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateProductId, validateUUID } from '@/lib/validations/product';
import { validateGrantAccess, sanitizeGrantAccessData } from '@/lib/validations/access';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/users/:id/access
 *
 * List product access for a user with cursor-based pagination.
 *
 * Query parameters:
 * - cursor: Pagination cursor (optional)
 * - limit: Items per page, max 100 (default: 20)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.USERS_READ]);
    const { id: userId } = await params;

    // Validate user ID format
    const idValidation = validateUUID(userId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid user ID format');
    }

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));

    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    const adminClient = createAdminClient();

    // Build paginated query
    let query = adminClient
      .from('user_product_access_detailed')
      .select('*')
      .eq('user_id', userId);

    query = applyCursorToQuery(query, cursor, 'access_created_at', 'desc');
    query = query.order('access_created_at', { ascending: false });
    query = query.order('id', { ascending: false });
    query = query.limit(limit + 1);

    const { data: accessData, error: accessError } = await query;

    if (accessError) {
      console.error('Error fetching user access:', accessError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch user access');
    }

    const { items: paginatedItems, pagination } = createPaginationResponse(
      (accessData || []) as Record<string, unknown>[],
      limit,
      'access_created_at',
      'desc',
      cursor
    );

    const access = paginatedItems.map(a => ({
      id: a.id,
      product_id: a.product_id,
      product_slug: a.product_slug,
      product_name: a.product_name,
      product_price: a.product_price,
      product_currency: a.product_currency,
      product_icon: a.product_icon,
      product_is_active: a.product_is_active,
      granted_at: a.access_created_at,
      expires_at: a.access_expires_at,
      duration_days: a.access_duration_days,
    }));

    return jsonResponse(successResponse(access, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * POST /api/v1/users/:id/access
 *
 * Grant user access to a product.
 *
 * Request body:
 * - product_id: string (required) - Product ID to grant access to
 * - access_duration_days: number (optional) - Duration in days
 * - access_expires_at: string ISO date (optional) - Specific expiration date
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.USERS_WRITE]);
    const { id: userId } = await params;

    // Validate user ID format
    const idValidation = validateUUID(userId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid user ID format');
    }

    // Parse and validate request body
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const sanitizedData = sanitizeGrantAccessData(body);

    const validation = validateGrantAccess(sanitizedData);
    if (!validation.isValid) {
      throw new ApiValidationError('Validation failed', {
        _errors: validation.errors,
      });
    }

    const productId = sanitizedData.product_id as string;
    const adminClient = createAdminClient();

    // Check if product exists and is active
    const { data: product, error: productError } = await adminClient
      .from('products')
      .select('id, name, is_active')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return apiError(request, 'NOT_FOUND', 'Product not found');
    }

    if (!product.is_active) {
      return apiError(request, 'VALIDATION_ERROR', 'Cannot grant access to inactive product');
    }

    // Check if user already has access
    const { data: existingAccess, error: existingError } = await adminClient
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error checking existing access:', existingError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to check existing access');
    }

    if (existingAccess) {
      return apiError(request, 'ALREADY_EXISTS', 'User already has access to this product');
    }

    // Build access data
    const accessData: {
      user_id: string;
      product_id: string;
      created_at: string;
      access_duration_days?: number;
      access_expires_at?: string;
    } = {
      user_id: userId,
      product_id: productId,
      created_at: new Date().toISOString(),
    };

    // Handle duration/expiration
    if (sanitizedData.access_duration_days) {
      const durationDays = sanitizedData.access_duration_days as number;
      accessData.access_duration_days = durationDays;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + durationDays);
      accessData.access_expires_at = expirationDate.toISOString();
    } else if (sanitizedData.access_expires_at) {
      accessData.access_expires_at = sanitizedData.access_expires_at as string;
    }

    // Grant access
    const { data: newAccess, error: accessError } = await adminClient
      .from('user_product_access')
      .insert(accessData)
      .select('id, product_id, created_at, access_expires_at, access_duration_days')
      .single();

    if (accessError) {
      // Check for foreign key violation (user doesn't exist)
      if (accessError.code === '23503') {
        return apiError(request, 'NOT_FOUND', 'User not found');
      }
      console.error('Error granting access:', accessError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to grant access');
    }

    return jsonResponse(
      successResponse({
        id: newAccess.id,
        user_id: userId,
        product_id: newAccess.product_id,
        product_name: product.name,
        granted_at: newAccess.created_at,
        expires_at: newAccess.access_expires_at,
        duration_days: newAccess.access_duration_days,
      }),
      request,
      201
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
