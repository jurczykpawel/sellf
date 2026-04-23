/**
 * Coupons API v1 - Single Coupon Operations
 *
 * GET /api/v1/coupons/:id - Get coupon details
 * PATCH /api/v1/coupons/:id - Update coupon
 * DELETE /api/v1/coupons/:id - Delete coupon
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
  ApiValidationError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/coupons/:id
 *
 * Get details of a specific coupon.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.COUPONS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid coupon ID format');
    }

    const { data: coupon, error } = await supabase
      .from('coupons')
      .select(`
        id,
        code,
        name,
        discount_type,
        discount_value,
        currency,
        is_active,
        is_public,
        starts_at,
        expires_at,
        usage_limit_global,
        usage_limit_per_user,
        current_usage_count,
        allowed_emails,
        allowed_product_ids,
        exclude_order_bumps,
        is_oto_coupon,
        oto_offer_id,
        source_transaction_id,
        created_at,
        updated_at
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Coupon not found');
      }
      console.error('Error fetching coupon:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch coupon');
    }

    return jsonResponse(successResponse(coupon), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/coupons/:id
 *
 * Update a coupon's settings.
 *
 * Request body (all optional):
 * - code: string
 * - name: string
 * - discount_type: 'percentage' | 'fixed'
 * - discount_value: number
 * - currency: string
 * - is_active: boolean
 * - is_public: boolean (reserved field; currently not used by runtime logic)
 * - starts_at: string ISO date
 * - expires_at: string ISO date (or null to remove)
 * - usage_limit_global: number (or null to remove)
 * - usage_limit_per_user: number
 * - allowed_emails: string[]
 * - allowed_product_ids: string[] (main checkout products only; a matching order bump alone does not activate the coupon)
 * - exclude_order_bumps: boolean
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.COUPONS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid coupon ID format');
    }

    // Check coupon exists
    const { data: existingCoupon, error: checkError } = await supabase
      .from('coupons')
      .select('id, discount_type, is_oto_coupon')
      .eq('id', id)
      .single();

    if (checkError || !existingCoupon) {
      return apiError(request, 'NOT_FOUND', 'Coupon not found');
    }

    // Parse body ONCE (stream can only be consumed once)
    const body = await parseJsonBody<{
      code?: string;
      name?: string;
      discount_type?: string;
      discount_value?: number;
      currency?: string;
      is_active?: boolean;
      is_public?: boolean;
      starts_at?: string;
      expires_at?: string | null;
      usage_limit_global?: number | null;
      usage_limit_per_user?: number;
      allowed_emails?: string[];
      allowed_product_ids?: string[];
      exclude_order_bumps?: boolean;
    }>(request);

    // OTO coupons have limited editability
    if (existingCoupon.is_oto_coupon) {
      const allowedOtoFields = ['is_active'];
      const providedFields = Object.keys(body);
      const invalidFields = providedFields.filter(f => !allowedOtoFields.includes(f));

      if (invalidFields.length > 0) {
        throw new ApiValidationError(
          `OTO coupons can only update: ${allowedOtoFields.join(', ')}. Invalid fields: ${invalidFields.join(', ')}`
        );
      }
    }

    // Build update data with validation
    const updateData: Record<string, unknown> = {};

    // Code
    if (body.code !== undefined) {
      if (typeof body.code !== 'string' || body.code.trim().length === 0) {
        throw new ApiValidationError('Coupon code cannot be empty');
      }
      const codeRegex = /^[A-Za-z0-9_-]+$/;
      if (!codeRegex.test(body.code)) {
        throw new ApiValidationError('Coupon code can only contain letters, numbers, hyphens, and underscores');
      }
      if (body.code.length > 50) {
        throw new ApiValidationError('Coupon code must be 50 characters or less');
      }
      updateData.code = body.code.toUpperCase().trim();
    }

    // Name
    if (body.name !== undefined) {
      if (body.name && body.name.length > 200) {
        throw new ApiValidationError('Coupon name must be 200 characters or less');
      }
      updateData.name = body.name?.trim() || null;
    }

    // Discount type
    if (body.discount_type !== undefined) {
      if (!['percentage', 'fixed'].includes(body.discount_type)) {
        throw new ApiValidationError('discount_type must be "percentage" or "fixed"');
      }
      updateData.discount_type = body.discount_type;
    }

    // Discount value
    if (body.discount_value !== undefined) {
      const discountValue = body.discount_value;
      const MAX_FIXED_DISCOUNT = 99999999;

      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        throw new ApiValidationError('Discount value must be a positive number');
      }

      const finalDiscountType = body.discount_type || existingCoupon.discount_type;

      if (finalDiscountType === 'percentage' && discountValue > 100) {
        throw new ApiValidationError('Percentage discount cannot exceed 100%');
      }

      if (finalDiscountType === 'fixed' && discountValue > MAX_FIXED_DISCOUNT) {
        throw new ApiValidationError(`Fixed discount cannot exceed ${MAX_FIXED_DISCOUNT} cents`);
      }

      updateData.discount_value = discountValue;
    }

    // Currency
    if (body.currency !== undefined) {
      if (body.currency) {
        if (!(SUPPORTED_CURRENCY_CODES as readonly string[]).includes(body.currency.toUpperCase())) {
          throw new ApiValidationError(`Unsupported currency code. Supported: ${SUPPORTED_CURRENCY_CODES.join(', ')}`);
        }
      }
      updateData.currency = body.currency || null;
    }

    // Boolean fields
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') {
        throw new ApiValidationError('is_active must be a boolean');
      }
      updateData.is_active = body.is_active;
    }

    if (body.is_public !== undefined) {
      if (typeof body.is_public !== 'boolean') {
        throw new ApiValidationError('is_public must be a boolean');
      }
      updateData.is_public = body.is_public;
    }

    if (body.exclude_order_bumps !== undefined) {
      if (typeof body.exclude_order_bumps !== 'boolean') {
        throw new ApiValidationError('exclude_order_bumps must be a boolean');
      }
      updateData.exclude_order_bumps = body.exclude_order_bumps;
    }

    // Date fields
    if (body.starts_at !== undefined) {
      const date = new Date(body.starts_at);
      if (isNaN(date.getTime())) {
        throw new ApiValidationError('Invalid starts_at date format');
      }
      updateData.starts_at = date.toISOString();
    }

    if (body.expires_at !== undefined) {
      if (body.expires_at === null) {
        updateData.expires_at = null;
      } else {
        const date = new Date(body.expires_at);
        if (isNaN(date.getTime())) {
          throw new ApiValidationError('Invalid expires_at date format');
        }
        updateData.expires_at = date.toISOString();
      }
    }

    // Usage limits
    if (body.usage_limit_global !== undefined) {
      if (body.usage_limit_global === null) {
        updateData.usage_limit_global = null;
      } else {
        if (!Number.isInteger(body.usage_limit_global) || body.usage_limit_global < 1 || body.usage_limit_global > 10000000) {
          throw new ApiValidationError('usage_limit_global must be a positive integer up to 10,000,000 or null');
        }
        updateData.usage_limit_global = body.usage_limit_global;
      }
    }

    if (body.usage_limit_per_user !== undefined) {
      if (!Number.isInteger(body.usage_limit_per_user) || body.usage_limit_per_user < 1 || body.usage_limit_per_user > 10000) {
        throw new ApiValidationError('usage_limit_per_user must be a positive integer up to 10,000');
      }
      updateData.usage_limit_per_user = body.usage_limit_per_user;
    }

    // Array fields
    if (body.allowed_emails !== undefined) {
      if (!Array.isArray(body.allowed_emails)) {
        throw new ApiValidationError('allowed_emails must be an array');
      }
      if (body.allowed_emails.length > 500) {
        throw new ApiValidationError('allowed_emails cannot exceed 500 entries');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const email of body.allowed_emails) {
        if (typeof email !== 'string' || !emailRegex.test(email)) {
          throw new ApiValidationError(`Invalid email format in allowed_emails: ${email}`);
        }
      }
      updateData.allowed_emails = body.allowed_emails;
    }

    if (body.allowed_product_ids !== undefined) {
      if (!Array.isArray(body.allowed_product_ids)) {
        throw new ApiValidationError('allowed_product_ids must be an array');
      }
      if (body.allowed_product_ids.length > 100) {
        throw new ApiValidationError('allowed_product_ids cannot exceed 100 entries');
      }
      for (const pid of body.allowed_product_ids) {
        const pidValidation = validateUUID(String(pid));
        if (!pidValidation.isValid) {
          throw new ApiValidationError(`Invalid product ID format in allowed_product_ids: ${pid}`);
        }
      }
      updateData.allowed_product_ids = body.allowed_product_ids;
    }

    if (Object.keys(updateData).length === 0) {
      throw new ApiValidationError('No valid update fields provided');
    }

    // Update coupon
    const { data: updatedCoupon, error: updateError } = await supabase
      .from('coupons')
      .update(updateData)
      .eq('id', id)
      .select(`
        id, code, name, discount_type, discount_value, currency,
        is_active, is_public, starts_at, expires_at,
        usage_limit_global, usage_limit_per_user, current_usage_count,
        allowed_emails, allowed_product_ids, exclude_order_bumps,
        is_oto_coupon, oto_offer_id, source_transaction_id,
        created_at, updated_at
      `)
      .single();

    if (updateError) {
      if (updateError.code === '23505') {
        return apiError(request, 'CONFLICT', 'Coupon code already exists');
      }
      console.error('Error updating coupon:', updateError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update coupon');
    }

    return jsonResponse(successResponse(updatedCoupon), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/coupons/:id
 *
 * Delete a coupon.
 * Note: This permanently deletes the coupon. For soft-delete, use PATCH with is_active: false.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.COUPONS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid coupon ID format');
    }

    // Check coupon exists
    const { data: existingCoupon, error: checkError } = await supabase
      .from('coupons')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingCoupon) {
      return apiError(request, 'NOT_FOUND', 'Coupon not found');
    }

    // Delete coupon (cascade will handle redemptions/reservations)
    const { error: deleteError } = await supabase
      .from('coupons')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting coupon:', deleteError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete coupon');
    }

    // Return 204 No Content on successful deletion
    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
