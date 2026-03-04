/**
 * API Keys Management - Single Key Operations
 *
 * GET /api/v1/api-keys/:id - Get key details
 * PATCH /api/v1/api-keys/:id - Update key (name, is_active)
 * DELETE /api/v1/api-keys/:id - Revoke key
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  handleApiError,
  parseJsonBody,
  ApiValidationError,
  successResponse,
} from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { requireAdminApi } from '@/lib/auth-server';
import { validateUUID } from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/api-keys/:id
 *
 * Get details of a specific API key.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { admin } = await requireAdminApi(supabase);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid key ID format');
    }

    const { data: key, error } = await supabase
      .from('api_keys')
      .select(`
        id,
        name,
        key_prefix,
        scopes,
        rate_limit_per_minute,
        is_active,
        expires_at,
        last_used_at,
        last_used_ip,
        usage_count,
        created_at,
        revoked_at,
        revoked_reason
      `)
      .eq('id', id)
      .eq('admin_user_id', admin.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'API key not found');
      }
      console.error('Error fetching API key:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch API key');
    }

    return jsonResponse(successResponse(key), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/api-keys/:id
 *
 * Update an API key's settings.
 *
 * Request body:
 * - name: string (optional)
 * - scopes: string[] (optional)
 * - rate_limit_per_minute: number (optional)
 * - is_active: boolean (optional) - Enable/disable key
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { admin } = await requireAdminApi(supabase);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid key ID format');
    }

    // Check key exists and belongs to this admin
    const { data: existingKey, error: checkError } = await supabase
      .from('api_keys')
      .select('id, is_active, revoked_at')
      .eq('id', id)
      .eq('admin_user_id', admin.id)
      .single();

    if (checkError || !existingKey) {
      return apiError(request, 'NOT_FOUND', 'API key not found');
    }

    // Can't update a revoked key
    if (existingKey.revoked_at) {
      return apiError(request, 'VALIDATION_ERROR', 'Cannot update a revoked key');
    }

    const body = await parseJsonBody<{
      name?: string;
      is_active?: boolean;
    }>(request);

    const updateData: Record<string, unknown> = {};

    // Validate and add name
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw new ApiValidationError('Name cannot be empty');
      }
      if (body.name.length > 100) {
        throw new ApiValidationError('Name must be less than 100 characters');
      }
      updateData.name = body.name.trim();
    }

    // Validate and add is_active
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') {
        throw new ApiValidationError('is_active must be a boolean');
      }
      updateData.is_active = body.is_active;
    }

    if (Object.keys(updateData).length === 0) {
      throw new ApiValidationError('No valid update fields provided');
    }

    // Update the key
    const { data: updatedKey, error: updateError } = await supabase
      .from('api_keys')
      .update(updateData)
      .eq('id', id)
      .select(`
        id,
        name,
        key_prefix,
        scopes,
        rate_limit_per_minute,
        is_active,
        expires_at,
        last_used_at,
        usage_count,
        created_at
      `)
      .single();

    if (updateError) {
      console.error('Error updating API key:', updateError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update API key');
    }

    return jsonResponse(successResponse(updatedKey), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/api-keys/:id
 *
 * Revoke an API key.
 * The key is not deleted but marked as revoked (for audit trail).
 *
 * Query params:
 * - reason: string (optional) - Reason for revocation
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { admin } = await requireAdminApi(supabase);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid key ID format');
    }

    // Check key exists and belongs to this admin
    const { data: existingKey, error: checkError } = await supabase
      .from('api_keys')
      .select('id, name, revoked_at')
      .eq('id', id)
      .eq('admin_user_id', admin.id)
      .single();

    if (checkError || !existingKey) {
      return apiError(request, 'NOT_FOUND', 'API key not found');
    }

    if (existingKey.revoked_at) {
      return apiError(request, 'VALIDATION_ERROR', 'Key is already revoked');
    }

    // Get revocation reason from query params
    const reason = request.nextUrl.searchParams.get('reason') || null;

    // Revoke the key
    const { error: revokeError } = await supabase
      .from('api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
      })
      .eq('id', id);

    if (revokeError) {
      console.error('Error revoking API key:', revokeError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to revoke API key');
    }

    return jsonResponse(
      successResponse({
        id,
        name: existingKey.name,
        revoked: true,
        revoked_at: new Date().toISOString(),
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
