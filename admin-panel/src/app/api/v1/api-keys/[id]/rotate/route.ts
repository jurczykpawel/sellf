/**
 * API Key Rotation
 *
 * POST /api/v1/api-keys/:id/rotate - Rotate an API key
 *
 * Creates a new key and optionally keeps the old one valid for a grace period.
 * This allows for zero-downtime key rotation.
 *
 * Platform admin only.
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
  generateApiKey,
} from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import { requireAdminApi } from '@/lib/auth-server';
import { resolveApiKeyOwner } from '@/lib/api/owner-resolution';
import { logApiKeyAuditEvent } from '@/lib/api/api-key-audit';
import { validateUUID } from '@/lib/validations/product';
import type { Database } from '@/types/database';

type ApiKeyInsert = Database['public']['Tables']['api_keys']['Insert'];

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * POST /api/v1/api-keys/:id/rotate
 *
 * Rotate an API key - generates a new key while optionally keeping the old one
 * valid for a grace period.
 *
 * Request body:
 * - grace_period_hours: number (optional) - Hours to keep old key valid (default: 24, max: 168)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { user, role } = await requireAdminApi(supabase, request);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid key ID format');
    }

    const owner = await resolveApiKeyOwner(user.id, role);
    if (!owner) {
      return apiError(request, 'FORBIDDEN', 'Account not found');
    }

    // Check key exists and belongs to this user (api_keys in public schema)
    const platformClient = createPlatformClient();
    let checkQuery = platformClient
      .from('api_keys')
      .select('id, name, scopes, rate_limit_per_minute, expires_at, is_active, revoked_at')
      .eq('id', id);

    checkQuery = checkQuery.eq('admin_user_id', owner.adminId!);

    const { data: oldKey, error: checkError } = await checkQuery.single();

    if (checkError || !oldKey) {
      return apiError(request, 'NOT_FOUND', 'API key not found');
    }

    if (oldKey.revoked_at) {
      return apiError(request, 'VALIDATION_ERROR', 'Cannot rotate a revoked key');
    }

    if (!oldKey.is_active) {
      return apiError(request, 'VALIDATION_ERROR', 'Cannot rotate an inactive key');
    }

    // Parse request body
    const body = await parseJsonBody<{
      grace_period_hours?: number;
    }>(request);

    // Validate grace period (default 24 hours, max 168 hours = 7 days)
    const gracePeriodHours = body.grace_period_hours ?? 24;
    if (typeof gracePeriodHours !== 'number' || !Number.isInteger(gracePeriodHours) || gracePeriodHours < 0 || gracePeriodHours > 168) {
      throw new ApiValidationError('Grace period must be an integer between 0 and 168 hours');
    }

    // Generate new key
    const newKeyData = generateApiKey(false);

    // Calculate grace period end time
    const graceUntil = gracePeriodHours > 0
      ? new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000).toISOString()
      : null;

    // Build insert payload preserving ownership from old key
    const baseInsert = {
      name: `${oldKey.name} (rotated)`,
      key_prefix: newKeyData.prefix,
      key_hash: newKeyData.hash,
      scopes: oldKey.scopes,
      rate_limit_per_minute: oldKey.rate_limit_per_minute,
      expires_at: oldKey.expires_at,
      rotated_from_id: oldKey.id,
    };

    const insertData: ApiKeyInsert = { ...baseInsert, admin_user_id: owner.adminId! };

    // Create new key (api_keys in public schema — use platform client)
    const { data: newKey, error: insertError } = await platformClient
      .from('api_keys')
      .insert(insertData)
      .select('id, name, key_prefix, scopes, rate_limit_per_minute, expires_at, created_at')
      .single();

    if (insertError) {
      console.error('Error creating rotated key:', insertError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create new key');
    }

    // Update old key - always deactivate, but set grace period if requested
    // The verify_api_key function checks rotation_grace_until when is_active = false
    const oldKeyUpdate = graceUntil
      ? { is_active: false, rotation_grace_until: graceUntil }
      : { is_active: false, revoked_at: new Date().toISOString(), revoked_reason: 'Rotated' };

    const { error: updateError } = await platformClient
      .from('api_keys')
      .update(oldKeyUpdate)
      .eq('id', oldKey.id);

    const warnings: string[] = [];
    if (updateError) {
      console.error('Error updating old key:', updateError);
      // The new key already exists and can't be un-created here, but the
      // response must not claim the old key was deactivated when it wasn't
      // — it's still fully active until this is retried.
      warnings.push('New key created, but the old key could not be deactivated. It is still active — retry the rotation or deactivate it manually.');
    }

    // Log rotation event through the shared audit helper (service-role client).
    await logApiKeyAuditEvent(oldKey.id, 'rotated', {
      new_key_id: newKey.id,
      grace_period_hours: gracePeriodHours,
      grace_until: graceUntil,
    });

    const oldKeyDeactivated = !updateError;
    const result = {
      new_key: {
        ...newKey,
        key: newKeyData.plaintext,
        warning: 'Save this key now - it will not be shown again!',
      },
      old_key: {
        id: oldKey.id,
        deactivated: oldKeyDeactivated,
        grace_until: oldKeyDeactivated ? graceUntil : null,
        message: !oldKeyDeactivated
          ? 'Old key could not be deactivated and is still active'
          : graceUntil
            ? `Old key will remain valid until ${graceUntil}`
            : 'Old key has been immediately deactivated',
      },
      ...(warnings.length > 0 ? { _warnings: warnings } : {}),
    };

    return jsonResponse(successResponse(result), request, warnings.length > 0 ? 207 : 201);
  } catch (error) {
    return handleApiError(error, request);
  }
}
