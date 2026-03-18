/**
 * Users API v1 - Single User Operations
 *
 * GET /api/v1/users/:id - Get user details with product access
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/users/:id
 *
 * Retrieve a single user by ID with their product access.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.USERS_READ]);
    const { id } = await params;

    // Validate ID format (reuse UUID validation)
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid user ID format');
    }

    const adminClient = auth.supabase;

    // seller_customer_stats: only users with access/transactions (prevents cross-schema leak)
    const { data: userStat, error: statsError } = await adminClient
      .from('seller_customer_stats')
      .select('user_id, email, user_created_at, email_confirmed_at, last_sign_in_at, raw_user_meta_data, total_products, total_value, last_access_granted_at, first_access_granted_at')
      .eq('user_id', id)
      .single();

    if (statsError) {
      if (statsError.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'User not found');
      }
      console.error('Error fetching user:', statsError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch user');
    }

    // Get user's product access (explicit fields)
    const { data: accessData, error: accessError } = await adminClient
      .from('user_product_access_detailed')
      .select('id, user_id, product_id, product_slug, product_name, product_description, product_price, product_currency, product_icon, product_is_active, access_created_at, access_expires_at, access_duration_days')
      .eq('user_id', id)
      .order('access_created_at', { ascending: false });

    if (accessError) {
      console.error('Error fetching user access:', accessError);
      // Continue without access data
    }

    const productAccess = (accessData || []).map(access => ({
      id: access.id,
      product_id: access.product_id,
      product_slug: access.product_slug,
      product_name: access.product_name,
      product_description: access.product_description,
      product_price: access.product_price,
      product_currency: access.product_currency,
      product_icon: access.product_icon,
      product_is_active: access.product_is_active,
      granted_at: access.access_created_at,
      expires_at: access.access_expires_at,
      duration_days: access.access_duration_days,
    }));

    const user = {
      id: userStat.user_id,
      email: userStat.email,
      created_at: userStat.user_created_at,
      email_confirmed_at: userStat.email_confirmed_at,
      last_sign_in_at: userStat.last_sign_in_at,
      user_metadata: userStat.raw_user_meta_data ? {
        full_name: (userStat.raw_user_meta_data as Record<string, unknown>).full_name,
        avatar_url: (userStat.raw_user_meta_data as Record<string, unknown>).avatar_url,
        name: (userStat.raw_user_meta_data as Record<string, unknown>).name,
      } : null,
      product_access: productAccess,
      stats: {
        total_products: userStat.total_products,
        total_value: userStat.total_value,
        last_access_granted_at: userStat.last_access_granted_at,
        first_access_granted_at: userStat.first_access_granted_at,
      },
    };

    return jsonResponse(successResponse(user), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
