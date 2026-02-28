/**
 * Users API v1 - List Users
 *
 * GET /api/v1/users - List users with cursor-based pagination
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  parseLimit,
  createPaginationResponse,
  applyCursorToQuery,
  validateCursor,
  API_SCOPES,
} from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { escapeIlikePattern } from '@/lib/validations/product';

// Valid sort columns for users
const USER_SORT_COLUMNS: Record<string, string> = {
  'created_at': 'user_created_at',
  'user_created_at': 'user_created_at',
  'email': 'email',
  'last_sign_in_at': 'last_sign_in_at',
  'total_products': 'total_products',
  'total_value': 'total_value',
  'last_access_granted_at': 'last_access_granted_at',
};

function validateUserSortColumn(sortBy: string | null): string {
  if (!sortBy || typeof sortBy !== 'string') {
    return 'user_created_at';
  }
  return USER_SORT_COLUMNS[sortBy] || 'user_created_at';
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/users
 *
 * Query parameters:
 * - cursor: Pagination cursor (optional)
 * - limit: Items per page, max 100 (default: 20)
 * - search: Search by email (optional)
 * - sort_by: Sort field (default: 'created_at')
 * - sort_order: Sort direction - 'asc' or 'desc' (default: 'desc')
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate with users:read scope
    await authenticate(request, [API_SCOPES.USERS_READ]);

    // Use admin client to access user views
    const adminClient = createAdminClient();

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const search = searchParams.get('search') || '';
    const sortByRaw = searchParams.get('sort_by') || 'created_at';
    const sortOrder = searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Validate sort column
    const sortBy = validateUserSortColumn(sortByRaw);

    // Pagination options - users view uses user_id instead of id
    const paginationOptions = { idField: 'user_id' };

    // Build query for user stats
    let query = adminClient
      .from('user_access_stats')
      .select('*');

    // Apply search filter
    if (search) {
      const escapedSearch = escapeIlikePattern(search);
      query = query.ilike('email', `%${escapedSearch}%`);
    }

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, sortBy, sortOrder, paginationOptions);

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    query = query.order('user_id', { ascending: sortOrder === 'asc' });

    // Fetch limit + 1 to check for more
    query = query.limit(limit + 1);

    const { data: userStats, error: statsError } = await query;

    if (statsError) {
      console.error('Error fetching user stats:', statsError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch users');
    }

    const allUsers = userStats || [];

    // Get user IDs for access lookup (before pagination slice)
    const usersForPage = allUsers.length > limit ? allUsers.slice(0, limit) : allUsers;
    const userIds = usersForPage.map(u => u.user_id);
    let userAccess: any[] = [];

    if (userIds.length > 0) {
      const { data: accessData, error: accessError } = await adminClient
        .from('user_product_access_detailed')
        .select('*')
        .in('user_id', userIds)
        .order('access_created_at', { ascending: false });

      if (accessError) {
        console.error('Error fetching user access:', accessError);
        // Continue without access data
      } else {
        userAccess = accessData || [];
      }
    }

    // Transform data - include user_id for pagination helper
    const transformedUsers = allUsers.map(userStat => {
      const productAccess = userAccess
        .filter(access => access.user_id === userStat.user_id)
        .map(access => ({
          id: access.id,
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
        }));

      return {
        id: userStat.user_id,
        user_id: userStat.user_id, // Keep for pagination helper
        email: userStat.email,
        created_at: userStat.user_created_at,
        email_confirmed_at: userStat.email_confirmed_at,
        last_sign_in_at: userStat.last_sign_in_at,
        user_metadata: userStat.raw_user_meta_data ? {
          full_name: (userStat.raw_user_meta_data as Record<string, unknown>).full_name,
          avatar_url: (userStat.raw_user_meta_data as Record<string, unknown>).avatar_url,
          name: (userStat.raw_user_meta_data as Record<string, unknown>).name,
        } : null,
        [sortBy]: (userStat as Record<string, unknown>)[sortBy], // Include sort field for pagination
        product_access: productAccess,
        stats: {
          total_products: userStat.total_products,
          total_value: userStat.total_value,
          last_access_granted_at: userStat.last_access_granted_at,
          first_access_granted_at: userStat.first_access_granted_at,
        },
      };
    });

    // Use pagination helper
    const { items, pagination } = createPaginationResponse(
      transformedUsers,
      limit,
      sortBy,
      sortOrder,
      cursor,
      paginationOptions
    );

    // Remove internal fields from response
    const cleanItems = items.map(({ user_id, [sortBy]: _sortField, ...rest }) => rest);

    return jsonResponse(successResponse(cleanItems, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
