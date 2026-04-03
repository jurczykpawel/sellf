/**
 * API Keys Management - List and Create
 *
 * GET /api/v1/api-keys - List API keys (without secrets)
 * POST /api/v1/api-keys - Create a new API key (returns secret ONCE)
 *
 * Platform admin only. Keys scoped to admin_user_id.
 *
 * NOTE: These endpoints require session auth (admin panel only)
 * API keys cannot create other API keys for security reasons.
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
  validateScopes,
  enforceApiKeyScopeGate,
} from '@/lib/api';
import { resolveCurrentTier } from '@/lib/license/resolve';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import { requireAdminApi } from '@/lib/auth-server';
import type { Database } from '@/types/database';

type ApiKeyInsert = Database['public']['Tables']['api_keys']['Insert'];

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/api-keys
 *
 * List all API keys for the authenticated platform admin.
 * Does NOT return the key secrets (they're only shown once at creation).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { user } = await requireAdminApi(supabase);

    // api_keys is in public schema — use platform client (service_role)
    const platformQuery = createPlatformClient();

    // Look up admin_users.id (public schema)
    const { data: admin } = await platformQuery
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!admin) {
      return apiError(request, 'FORBIDDEN', 'Admin account not found');
    }

    const { data: keys, error } = await platformQuery
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
        usage_count,
        created_at,
        revoked_at
      `)
      .eq('admin_user_id', admin.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching API keys:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch API keys');
    }

    return jsonResponse(successResponse(keys || []), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * POST /api/v1/api-keys
 *
 * Create a new API key.
 * The full key is returned ONLY in this response - it cannot be retrieved later.
 *
 * Request body:
 * - name: string (required) - Descriptive name for the key
 * - scopes: string[] (optional) - Array of permission scopes, defaults to ["*"]
 * - rate_limit_per_minute: number (optional) - Rate limit, default 60
 * - expires_at: string ISO date (optional) - Expiration date
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { user } = await requireAdminApi(supabase);

    const body = await parseJsonBody<{
      name?: string;
      scopes?: string[];
      rate_limit_per_minute?: number;
      expires_at?: string;
    }>(request);

    // Validate name
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw new ApiValidationError('Name is required');
    }

    if (body.name.length > 100) {
      throw new ApiValidationError('Name must be less than 100 characters');
    }

    // License-based scope gating: free tier = locked to ['*']
    const tier = await resolveCurrentTier();
    const scopeGate = enforceApiKeyScopeGate(tier, body.scopes);
    const scopes = scopeGate.scopes;

    // Only validate custom scopes (gated scopes are always valid)
    if (!scopeGate.gated) {
      const scopeValidation = validateScopes(scopes);
      if (!scopeValidation.isValid) {
        throw new ApiValidationError(
          `Invalid scopes: ${scopeValidation.invalidScopes.join(', ')}`
        );
      }
    }

    // Validate rate limit
    const rateLimit = body.rate_limit_per_minute ?? 60;
    if (typeof rateLimit !== 'number' || !Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 1000) {
      throw new ApiValidationError('Rate limit must be an integer between 1 and 1000');
    }

    // Validate expiration
    let expiresAt: string | null = null;
    if (body.expires_at) {
      const expiryDate = new Date(body.expires_at);
      if (isNaN(expiryDate.getTime())) {
        throw new ApiValidationError('Invalid expiration date format');
      }
      if (expiryDate <= new Date()) {
        throw new ApiValidationError('Expiration date must be in the future');
      }
      expiresAt = expiryDate.toISOString();
    }

    // Generate the key
    const generatedKey = generateApiKey(false); // Live key

    // Look up admin_users.id
    const { data: admin } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!admin) {
      return apiError(request, 'FORBIDDEN', 'Admin account not found');
    }

    const insertData: ApiKeyInsert = {
      name: body.name.trim(),
      key_prefix: generatedKey.prefix,
      key_hash: generatedKey.hash,
      scopes,
      rate_limit_per_minute: rateLimit,
      expires_at: expiresAt,
      admin_user_id: admin.id,
    };

    // Insert into database using platform client (api_keys is in public schema, needs service_role)
    const platformForInsert = createPlatformClient();
    const { data: newKey, error: insertError } = await platformForInsert
      .from('api_keys')
      .insert(insertData)
      .select('id, name, key_prefix, scopes, rate_limit_per_minute, expires_at, created_at')
      .single();

    if (insertError) {
      console.error('Error creating API key:', insertError);

      if (insertError.code === '23505') {
        // Unique constraint violation - extremely rare but handle it
        return apiError(request, 'CONFLICT', 'Failed to generate unique key, please try again');
      }

      return apiError(request, 'INTERNAL_ERROR', 'Failed to create API key');
    }

    // Return with the full key (only time it's returned)
    return jsonResponse(
      successResponse({
        ...newKey,
        // Include the full key ONCE - warn user to save it
        key: generatedKey.plaintext,
        warning: 'Save this key now - it will not be shown again!',
      }),
      request,
      201
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
