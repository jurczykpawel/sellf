/**
 * API Keys Management - List and Create
 *
 * GET /api/v1/api-keys - List API keys (without secrets)
 * POST /api/v1/api-keys - Create a new API key (returns secret ONCE)
 *
 * Supports both platform admins and seller admins.
 * Platform admins: keys scoped to admin_user_id, seller_id = NULL
 * Seller admins: keys scoped to seller_id, admin_user_id = NULL
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
  hashApiKey,
  validateScopes,
  API_SCOPES,
  SCOPE_PRESETS,
} from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import type { Database } from '@/types/database';

type ApiKeyInsert = Database['public']['Tables']['api_keys']['Insert'];

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * Resolve the seller ID for a seller admin user.
 * Returns null if not found (should not happen after auth check).
 */
async function getSellerIdForUser(userId: string): Promise<string | null> {
  const platform = createPlatformClient();
  const { data } = await platform
    .from('sellers')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  return data?.id ?? null;
}

/**
 * GET /api/v1/api-keys
 *
 * List all API keys for the authenticated admin or seller.
 * Does NOT return the key secrets (they're only shown once at creation).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { user, role } = await requireAdminOrSellerApi(supabase);

    // api_keys is in public schema — use platform client (service_role)
    const platformQuery = createPlatformClient();
    let query = platformQuery
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
      .order('created_at', { ascending: false });

    if (role === 'seller_admin') {
      const sellerId = await getSellerIdForUser(user.id);
      if (!sellerId) {
        return apiError(request, 'FORBIDDEN', 'Seller account not found');
      }
      query = query.eq('seller_id', sellerId);
    } else {
      // Platform admin: look up admin_users.id (public schema)
      const { data: admin } = await platformQuery
        .from('admin_users')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!admin) {
        return apiError(request, 'FORBIDDEN', 'Admin account not found');
      }
      query = query.eq('admin_user_id', admin.id);
    }

    const { data: keys, error } = await query;

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
    const { user, role } = await requireAdminOrSellerApi(supabase);

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

    // Validate scopes
    let scopes = body.scopes || [API_SCOPES.FULL_ACCESS];
    const scopeValidation = validateScopes(scopes);
    if (!scopeValidation.isValid) {
      throw new ApiValidationError(
        `Invalid scopes: ${scopeValidation.invalidScopes.join(', ')}`
      );
    }

    // Seller admins cannot self-assign scopes beyond their allowed set
    if (role === 'seller_admin') {
      const allowedScopes: readonly string[] = SCOPE_PRESETS.sellerDefault;
      scopes = scopes.filter((s: string) => allowedScopes.includes(s));
      if (scopes.length === 0) {
        throw new ApiValidationError(
          'No valid scopes for seller. Allowed scopes: ' + allowedScopes.join(', ')
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

    // Build insert payload based on role
    const baseInsert = {
      name: body.name.trim(),
      key_prefix: generatedKey.prefix,
      key_hash: generatedKey.hash,
      scopes,
      rate_limit_per_minute: rateLimit,
      expires_at: expiresAt,
    };

    let insertData: ApiKeyInsert;

    if (role === 'seller_admin') {
      const sellerId = await getSellerIdForUser(user.id);
      if (!sellerId) {
        return apiError(request, 'FORBIDDEN', 'Seller account not found');
      }
      insertData = { ...baseInsert, seller_id: sellerId };
      // admin_user_id stays NULL for seller keys
    } else {
      // Platform admin
      const { data: admin } = await supabase
        .from('admin_users')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!admin) {
        return apiError(request, 'FORBIDDEN', 'Admin account not found');
      }
      insertData = { ...baseInsert, admin_user_id: admin.id };
      // seller_id stays NULL for platform keys
    }

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
