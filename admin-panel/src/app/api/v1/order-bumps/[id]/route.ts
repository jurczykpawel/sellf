/**
 * Order Bumps API v1 - Single Order Bump Operations
 *
 * GET /api/v1/order-bumps/[id] - Get an order bump
 * PATCH /api/v1/order-bumps/[id] - Update an order bump
 * DELETE /api/v1/order-bumps/[id] - Delete an order bump
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  noContentResponse,
  parseJsonBody,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { ORDER_BUMP_SELECT } from '../constants';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/order-bumps/[id]
 *
 * Get a single order bump.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);

    const { id } = await context.params;

    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid order bump ID format');
    }

    const { data, error } = await supabase
      .from('order_bumps')
      .select(ORDER_BUMP_SELECT)
      .eq('id', id)
      .single();

    if (error || !data) {
      return apiError(request, 'NOT_FOUND', 'Order bump not found');
    }

    return jsonResponse(successResponse(data), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/order-bumps/[id]
 *
 * Update an existing order bump.
 *
 * Body (all optional):
 * - bump_product_id: string
 * - bump_price: number | null
 * - bump_title: string
 * - bump_description: string
 * - is_active: boolean
 * - display_order: number
 * - access_duration_days: number | null
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const { id } = await context.params;

    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid order bump ID format');
    }

    // Check if order bump exists
    const { data: existing, error: fetchError } = await supabase
      .from('order_bumps')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return apiError(request, 'NOT_FOUND', 'Order bump not found');
    }

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const {
      bump_product_id,
      bump_price,
      bump_title,
      bump_description,
      is_active,
      display_order,
      access_duration_days,
      urgency_duration_minutes,
    } = body;

    // Validate string lengths
    if (bump_title !== undefined && typeof bump_title === 'string' && bump_title.length > 200) {
      return apiError(request, 'VALIDATION_ERROR', 'Bump title too long', {
        bump_title: ['Bump title must be 200 characters or less']
      });
    }
    if (bump_description !== undefined && bump_description !== null && typeof bump_description === 'string' && bump_description.length > 2000) {
      return apiError(request, 'VALIDATION_ERROR', 'Bump description too long', {
        bump_description: ['Bump description must be 2000 characters or less']
      });
    }

    // Validate bump_price if provided
    if (bump_price !== undefined && bump_price !== null) {
      if (typeof bump_price !== 'number' || !Number.isFinite(bump_price) || bump_price < 0 || bump_price > 999999.99) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid bump price', {
          bump_price: ['Bump price must be a number between 0 and 999999.99']
        });
      }
    }

    // Validate bump_product_id if changed
    if (bump_product_id) {
      const bumpIdValidation = validateUUID(String(bump_product_id));
      if (!bumpIdValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid bump product ID format');
      }

      const { data: bumpProduct } = await supabase
        .from('products')
        .select('id, is_active')
        .eq('id', String(bump_product_id))
        .single();

      if (!bumpProduct || !bumpProduct.is_active) {
        return apiError(request, 'VALIDATION_ERROR', 'Bump product not found or inactive', {
          bump_product_id: ['Bump product not found or inactive']
        });
      }
    }

    // Validate display_order if provided
    if (display_order !== undefined) {
      if (typeof display_order !== 'number' || !Number.isInteger(display_order) || display_order < 0 || display_order > 1000) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid display order', {
          display_order: ['Display order must be an integer between 0 and 1000']
        });
      }
    }

    // Validate access_duration_days if provided
    if (access_duration_days !== undefined && access_duration_days !== null) {
      if (typeof access_duration_days !== 'number' || !Number.isInteger(access_duration_days) || access_duration_days < 1 || access_duration_days > 3650) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid access duration', {
          access_duration_days: ['Access duration must be an integer between 1 and 3650 days']
        });
      }
    }

    // Validate urgency_duration_minutes if provided
    if (urgency_duration_minutes !== undefined && urgency_duration_minutes !== null) {
      if (typeof urgency_duration_minutes !== 'number' || !Number.isInteger(urgency_duration_minutes) || urgency_duration_minutes < 1 || urgency_duration_minutes > 1440) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid urgency duration', {
          urgency_duration_minutes: ['Urgency duration must be an integer between 1 and 1440 minutes']
        });
      }
    }

    // Validate is_active type if provided
    if (is_active !== undefined && typeof is_active !== 'boolean') {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid is_active value', {
        is_active: ['is_active must be a boolean']
      });
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (bump_product_id !== undefined) updates.bump_product_id = bump_product_id;
    if (bump_price !== undefined) updates.bump_price = bump_price;
    if (bump_title !== undefined) updates.bump_title = bump_title;
    if (bump_description !== undefined) updates.bump_description = bump_description;
    if (is_active !== undefined) updates.is_active = is_active;
    if (display_order !== undefined) updates.display_order = display_order;
    if (access_duration_days !== undefined) updates.access_duration_days = access_duration_days;
    if (urgency_duration_minutes !== undefined) updates.urgency_duration_minutes = urgency_duration_minutes;

    if (Object.keys(updates).length === 0) {
      return apiError(request, 'VALIDATION_ERROR', 'No valid update fields provided');
    }

    // Update order bump
    const { data, error } = await supabase
      .from('order_bumps')
      .update(updates)
      .eq('id', id)
      .select(ORDER_BUMP_SELECT)
      .single();

    if (error) {
      console.error('Error updating order bump:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
        return apiError(request, 'CONFLICT', 'Order bump already exists for this product pair');
      }

      return apiError(request, 'INTERNAL_ERROR', 'Failed to update order bump');
    }

    return jsonResponse(successResponse(data), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/order-bumps/[id]
 *
 * Delete an order bump.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const { id } = await context.params;

    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid order bump ID format');
    }

    // Check if order bump exists
    const { data: existing, error: fetchError } = await supabase
      .from('order_bumps')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return apiError(request, 'NOT_FOUND', 'Order bump not found');
    }

    // Delete order bump
    const { error } = await supabase
      .from('order_bumps')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting order bump:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete order bump');
    }

    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
