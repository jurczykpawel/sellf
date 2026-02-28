/**
 * Users API v1 - Individual Access Management
 *
 * GET /api/v1/users/:id/access/:accessId - Get access details
 * PATCH /api/v1/users/:id/access/:accessId - Extend/modify access
 * DELETE /api/v1/users/:id/access/:accessId - Revoke access
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  noContentResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateUUID } from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string; accessId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/users/:id/access/:accessId
 *
 * Get details of a specific access entry.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.USERS_READ]);
    const { id: userId, accessId } = await params;

    // Validate IDs
    const userIdValidation = validateUUID(userId);
    const accessIdValidation = validateUUID(accessId);

    if (!userIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid user ID format');
    }
    if (!accessIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid access ID format');
    }

    const adminClient = createAdminClient();

    // Get access details
    const { data: access, error } = await adminClient
      .from('user_product_access_detailed')
      .select('*')
      .eq('id', accessId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Access entry not found');
      }
      console.error('Error fetching access:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch access');
    }

    return jsonResponse(
      successResponse({
        id: access.id,
        user_id: access.user_id,
        product_id: access.product_id,
        product_slug: access.product_slug,
        product_name: access.product_name,
        product_price: access.product_price,
        product_currency: access.product_currency,
        product_icon: access.product_icon,
        product_is_active: access.product_is_active,
        granted_at: access.access_created_at,
        expires_at: access.access_expires_at,
        duration_days: access.access_duration_days,
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/users/:id/access/:accessId
 *
 * Extend or modify access expiration.
 *
 * Request body:
 * - extend_days: number (optional) - Add days to current expiration
 * - access_expires_at: string ISO date (optional) - Set specific expiration
 * - access_duration_days: number (optional) - Set duration from now
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.USERS_WRITE]);
    const { id: userId, accessId } = await params;

    // Validate IDs
    const userIdValidation = validateUUID(userId);
    const accessIdValidation = validateUUID(accessId);

    if (!userIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid user ID format');
    }
    if (!accessIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid access ID format');
    }

    const adminClient = createAdminClient();

    // Check access exists
    const { data: existingAccess, error: checkError } = await adminClient
      .from('user_product_access')
      .select('id, access_expires_at')
      .eq('id', accessId)
      .eq('user_id', userId)
      .single();

    if (checkError || !existingAccess) {
      return apiError(request, 'NOT_FOUND', 'Access entry not found');
    }

    // Parse request body
    const body = await parseJsonBody<Record<string, unknown>>(request);

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (body.extend_days !== undefined) {
      const extendDays = Number(body.extend_days);
      if (isNaN(extendDays) || extendDays < 1 || extendDays > 3650) {
        return apiError(request, 'VALIDATION_ERROR', 'extend_days must be between 1 and 3650');
      }

      // Extend from current expiration or from now
      const baseDate = existingAccess.access_expires_at
        ? new Date(existingAccess.access_expires_at)
        : new Date();

      // If already expired, extend from now
      if (baseDate < new Date()) {
        baseDate.setTime(Date.now());
      }

      baseDate.setDate(baseDate.getDate() + extendDays);
      updateData.access_expires_at = baseDate.toISOString();
    } else if (body.access_expires_at !== undefined) {
      const expiresAt = new Date(body.access_expires_at as string);
      if (isNaN(expiresAt.getTime())) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid access_expires_at format');
      }
      if (expiresAt <= new Date()) {
        return apiError(request, 'VALIDATION_ERROR', 'access_expires_at must be in the future');
      }
      updateData.access_expires_at = expiresAt.toISOString();
    } else if (body.access_duration_days !== undefined) {
      const durationDays = Number(body.access_duration_days);
      if (isNaN(durationDays) || durationDays < 1 || durationDays > 3650) {
        return apiError(request, 'VALIDATION_ERROR', 'access_duration_days must be between 1 and 3650');
      }
      updateData.access_duration_days = durationDays;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + durationDays);
      updateData.access_expires_at = expirationDate.toISOString();
    }

    if (Object.keys(updateData).length === 0) {
      return apiError(request, 'VALIDATION_ERROR', 'No valid update fields provided');
    }

    // Update access
    const { error: updateError } = await adminClient
      .from('user_product_access')
      .update(updateData)
      .eq('id', accessId);

    if (updateError) {
      console.error('Error updating access:', updateError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update access');
    }

    // Fetch enriched response from detailed view (matching GET shape)
    const { data: enrichedAccess, error: fetchError } = await adminClient
      .from('user_product_access_detailed')
      .select('*')
      .eq('id', accessId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !enrichedAccess) {
      console.error('Error fetching updated access:', fetchError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch updated access');
    }

    return jsonResponse(
      successResponse({
        id: enrichedAccess.id,
        user_id: enrichedAccess.user_id,
        product_id: enrichedAccess.product_id,
        product_slug: enrichedAccess.product_slug,
        product_name: enrichedAccess.product_name,
        product_price: enrichedAccess.product_price,
        product_currency: enrichedAccess.product_currency,
        product_icon: enrichedAccess.product_icon,
        product_is_active: enrichedAccess.product_is_active,
        granted_at: enrichedAccess.access_created_at,
        expires_at: enrichedAccess.access_expires_at,
        duration_days: enrichedAccess.access_duration_days,
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/users/:id/access/:accessId
 *
 * Revoke user's access to a product.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.USERS_WRITE]);
    const { id: userId, accessId } = await params;

    // Validate IDs
    const userIdValidation = validateUUID(userId);
    const accessIdValidation = validateUUID(accessId);

    if (!userIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid user ID format');
    }
    if (!accessIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid access ID format');
    }

    const adminClient = createAdminClient();

    // Check access exists
    const { data: existingAccess, error: checkError } = await adminClient
      .from('user_product_access')
      .select('id, product_id')
      .eq('id', accessId)
      .eq('user_id', userId)
      .single();

    if (checkError || !existingAccess) {
      return apiError(request, 'NOT_FOUND', 'Access entry not found');
    }

    // Delete access
    const { error: deleteError } = await adminClient
      .from('user_product_access')
      .delete()
      .eq('id', accessId);

    if (deleteError) {
      console.error('Error revoking access:', deleteError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to revoke access');
    }

    // Return 204 No Content on successful deletion
    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
