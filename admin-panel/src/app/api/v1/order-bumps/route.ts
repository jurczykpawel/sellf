/**
 * Order Bumps API v1
 *
 * GET /api/v1/order-bumps - List all order bumps
 * POST /api/v1/order-bumps - Create a new order bump
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  successResponse,
  parseLimit,
  createPaginationResponse,
  applyCursorToQuery,
  validateCursor,
  API_SCOPES,
} from '@/lib/api';
import { validateProductId, validateUUID } from '@/lib/validations/product';
import { ORDER_BUMP_SELECT } from './constants';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/order-bumps
 *
 * List order bumps with cursor-based pagination.
 *
 * Query params:
 * - product_id: UUID (optional) - Filter by main product
 * - cursor: Pagination cursor (optional)
 * - limit: Items per page, max 100 (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);

    const searchParams = request.nextUrl.searchParams;
    const productId = searchParams.get('product_id');
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));

    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    if (productId) {
      const idValidation = validateProductId(productId);
      if (!idValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
      }
    }

    let query = supabase
      .from('order_bumps')
      .select(ORDER_BUMP_SELECT);

    if (productId) {
      query = query.eq('main_product_id', productId);
    }

    query = applyCursorToQuery(query, cursor, 'created_at', 'desc');
    query = query.order('created_at', { ascending: false });
    query = query.order('id', { ascending: false });
    query = query.limit(limit + 1);

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching order bumps:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch order bumps');
    }

    const { items, pagination } = createPaginationResponse(
      (data || []) as Record<string, unknown>[],
      limit,
      'created_at',
      'desc',
      cursor
    );

    return jsonResponse(successResponse(items, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * POST /api/v1/order-bumps
 *
 * Create a new order bump configuration.
 *
 * Body:
 * - main_product_id: string (required)
 * - bump_product_id: string (required)
 * - bump_title: string (required)
 * - bump_price: number | null (optional)
 * - bump_description: string (optional)
 * - is_active: boolean (default: true)
 * - display_order: number (default: 0)
 * - access_duration_days: number | null (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const {
      main_product_id,
      bump_product_id,
      bump_title,
      bump_price,
      bump_description,
      is_active = true,
      display_order = 0,
      access_duration_days,
      urgency_duration_minutes,
    } = body;

    // Validate required fields
    const errors: Record<string, string[]> = {};
    if (!main_product_id) {
      errors.main_product_id = ['Main product ID is required'];
    }
    if (!bump_product_id) {
      errors.bump_product_id = ['Bump product ID is required'];
    }
    if (!bump_title) {
      errors.bump_title = ['Bump title is required'];
    }

    if (Object.keys(errors).length > 0) {
      return apiError(request, 'VALIDATION_ERROR', 'Missing required fields', errors);
    }

    // Validate string lengths
    if (typeof bump_title === 'string' && bump_title.length > 200) {
      return apiError(request, 'VALIDATION_ERROR', 'Bump title too long', {
        bump_title: ['Bump title must be 200 characters or less']
      });
    }
    if (bump_description !== undefined && bump_description !== null && typeof bump_description === 'string' && bump_description.length > 2000) {
      return apiError(request, 'VALIDATION_ERROR', 'Bump description too long', {
        bump_description: ['Bump description must be 2000 characters or less']
      });
    }

    // Validate UUID formats
    const mainIdValidation = validateUUID(String(main_product_id));
    if (!mainIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid main product ID format');
    }
    const bumpIdValidation = validateUUID(String(bump_product_id));
    if (!bumpIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid bump product ID format');
    }

    // Prevent self-referencing order bump
    if (String(main_product_id) === String(bump_product_id)) {
      return apiError(request, 'VALIDATION_ERROR', 'Main product and bump product must be different', {
        bump_product_id: ['Bump product cannot be the same as main product']
      });
    }

    // Validate that products exist and are active
    const { data: mainProduct } = await supabase
      .from('products')
      .select('id, is_active')
      .eq('id', String(main_product_id))
      .single();

    if (!mainProduct || !mainProduct.is_active) {
      return apiError(request, 'VALIDATION_ERROR', 'Main product not found or inactive', {
        main_product_id: ['Main product not found or inactive']
      });
    }

    const { data: bumpProduct } = await supabase
      .from('products')
      .select('id, is_active, price')
      .eq('id', String(bump_product_id))
      .single();

    if (!bumpProduct || !bumpProduct.is_active) {
      return apiError(request, 'VALIDATION_ERROR', 'Bump product not found or inactive', {
        bump_product_id: ['Bump product not found or inactive']
      });
    }

    // Validate is_active type
    if (is_active !== undefined && typeof is_active !== 'boolean') {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid is_active value', {
        is_active: ['is_active must be a boolean']
      });
    }

    // Validate bump_price if provided
    if (bump_price !== null && bump_price !== undefined) {
      if (typeof bump_price !== 'number' || !Number.isFinite(bump_price) || bump_price < 0 || bump_price > 999999.99) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid bump price', {
          bump_price: ['Bump price must be a number between 0 and 999999.99']
        });
      }
    }

    // Validate display_order
    if (display_order !== undefined) {
      if (typeof display_order !== 'number' || !Number.isInteger(display_order) || display_order < 0 || display_order > 1000) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid display order', {
          display_order: ['Display order must be an integer between 0 and 1000']
        });
      }
    }

    // Validate access_duration_days
    if (access_duration_days !== null && access_duration_days !== undefined) {
      if (typeof access_duration_days !== 'number' || !Number.isInteger(access_duration_days) || access_duration_days < 1 || access_duration_days > 3650) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid access duration', {
          access_duration_days: ['Access duration must be an integer between 1 and 3650 days']
        });
      }
    }

    // Validate urgency_duration_minutes
    if (urgency_duration_minutes !== null && urgency_duration_minutes !== undefined) {
      if (typeof urgency_duration_minutes !== 'number' || !Number.isInteger(urgency_duration_minutes) || urgency_duration_minutes < 1 || urgency_duration_minutes > 1440) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid urgency duration', {
          urgency_duration_minutes: ['Urgency duration must be an integer between 1 and 1440 minutes']
        });
      }
    }

    // Create order bump
    const { data, error } = await supabase
      .from('order_bumps')
      .insert({
        main_product_id: String(main_product_id),
        bump_product_id: String(bump_product_id),
        bump_price: bump_price ?? null,
        bump_title: String(bump_title),
        bump_description: bump_description ? String(bump_description) : null,
        is_active,
        display_order,
        access_duration_days: access_duration_days ?? null,
        urgency_duration_minutes: urgency_duration_minutes ?? null,
      })
      .select(ORDER_BUMP_SELECT)
      .single();

    if (error) {
      console.error('Error creating order bump:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
        return apiError(request, 'CONFLICT', 'Order bump already exists for this product pair');
      }

      return apiError(request, 'INTERNAL_ERROR', 'Failed to create order bump');
    }

    return jsonResponse(successResponse(data), request, 201);
  } catch (error) {
    return handleApiError(error, request);
  }
}
