/**
 * Coupons API v1 - List and Create
 *
 * GET /api/v1/coupons - List coupons with filters and pagination
 * POST /api/v1/coupons - Create a new coupon
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  ApiValidationError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { parseLimit, applyCursorToQuery, createPaginationResponse, validateCursor } from '@/lib/api/pagination';
import { escapeIlikePattern, validateUUID } from '@/lib/validations/product';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';

const COUPON_API_FIELDS = `
  id, code, name, discount_type, discount_value, currency,
  is_active, is_public, starts_at, expires_at,
  usage_limit_global, usage_limit_per_user, current_usage_count,
  allowed_emails, allowed_product_ids, exclude_order_bumps,
  is_oto_coupon, oto_offer_id, source_transaction_id,
  created_at, updated_at
`;

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/coupons
 *
 * List all coupons with optional filters.
 *
 * Query params:
 * - cursor: string (pagination cursor)
 * - limit: number (default 50, max 100)
 * - status: 'all' | 'active' | 'inactive' | 'expired' (default 'all')
 * - search: string (search in code and name)
 * - sort: string (default '-created_at')
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.COUPONS_READ]);
    const { searchParams } = request.nextUrl;

    // Parse params
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const status = searchParams.get('status') || 'all';
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || '-created_at';

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build query
    let query = supabase
      .from('coupons')
      .select(COUPON_API_FIELDS);

    // Filter by status
    if (status !== 'all') {
      const validStatuses = ['active', 'inactive', 'expired'];
      if (!validStatuses.includes(status)) {
        return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: all, ${validStatuses.join(', ')}`);
      }
      if (status === 'active') {
        query = query
          .eq('is_active', true)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
      } else if (status === 'inactive') {
        query = query.eq('is_active', false);
      } else if (status === 'expired') {
        query = query
          .not('expires_at', 'is', null)
          .lt('expires_at', new Date().toISOString());
      }
    }

    // Search by code or name
    if (search) {
      const escapedSearch = escapeIlikePattern(search);
      query = query.or(`code.ilike.%${escapedSearch}%,name.ilike.%${escapedSearch}%`);
    }

    // Sorting
    const isDescending = sort.startsWith('-');
    const sortField = isDescending ? sort.slice(1) : sort;
    const allowedSortFields = ['created_at', 'updated_at', 'code', 'name', 'current_usage_count'];

    if (!allowedSortFields.includes(sortField)) {
      return apiError(request, 'INVALID_INPUT', `Invalid sort field. Allowed: ${allowedSortFields.join(', ')}`);
    }

    const orderDirection = isDescending ? 'desc' : 'asc';

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, sortField, orderDirection);

    query = query
      .order(sortField, { ascending: !isDescending })
      .order('id', { ascending: !isDescending })
      .limit(limit + 1);

    const { data: coupons, error } = await query;

    if (error) {
      console.error('Error fetching coupons:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch coupons');
    }

    const { items, pagination } = createPaginationResponse(
      coupons as { id: string }[],
      limit,
      sortField,
      orderDirection,
      cursor
    );

    return jsonResponse(successResponse(items, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * POST /api/v1/coupons
 *
 * Create a new coupon.
 *
 * Request body:
 * - code: string (required) - Unique coupon code
 * - name: string (optional) - Display name
 * - discount_type: 'percentage' | 'fixed' (required)
 * - discount_value: number (required) - Percentage (0-100) or fixed amount in cents
 * - currency: string (optional) - Required for fixed discounts
 * - is_active: boolean (default true)
 * - is_public: boolean (default false) - Reserved field; currently not used by runtime logic
 * - starts_at: string ISO date (optional, default now)
 * - expires_at: string ISO date (optional)
 * - usage_limit_global: number (optional) - Max total uses
 * - usage_limit_per_user: number (default 1) - Max uses per email
 * - allowed_emails: string[] (optional) - Restrict to specific emails
 * - allowed_product_ids: string[] (optional) - Restrict to specific main checkout products; a matching order bump alone does not activate the coupon
 * - exclude_order_bumps: boolean (default false)
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.COUPONS_WRITE]);

    const body = await parseJsonBody<{
      code?: string;
      name?: string;
      discount_type?: string;
      discount_value?: number;
      currency?: string;
      is_active?: boolean;
      is_public?: boolean;
      starts_at?: string;
      expires_at?: string;
      usage_limit_global?: number;
      usage_limit_per_user?: number;
      allowed_emails?: string[];
      allowed_product_ids?: string[];
      exclude_order_bumps?: boolean;
    }>(request);

    // Validate required fields
    if (!body.code || typeof body.code !== 'string' || body.code.trim().length === 0) {
      throw new ApiValidationError('Coupon code is required');
    }

    if (!body.discount_type || !['percentage', 'fixed'].includes(body.discount_type)) {
      throw new ApiValidationError('discount_type must be "percentage" or "fixed"');
    }

    if (body.discount_value === undefined || typeof body.discount_value !== 'number') {
      throw new ApiValidationError('discount_value is required and must be a number');
    }

    // Validate discount_value
    const discountValue = body.discount_value;
    const MAX_FIXED_DISCOUNT = 99999999; // ~$999,999.99 in cents

    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw new ApiValidationError('Discount value must be a positive number');
    }

    if (body.discount_type === 'percentage' && discountValue > 100) {
      throw new ApiValidationError('Percentage discount cannot exceed 100%');
    }

    if (body.discount_type === 'fixed') {
      if (discountValue > MAX_FIXED_DISCOUNT) {
        throw new ApiValidationError(`Fixed discount cannot exceed ${MAX_FIXED_DISCOUNT} cents`);
      }
      if (!body.currency) {
        throw new ApiValidationError('Currency is required for fixed discount coupons');
      }
      if (!(SUPPORTED_CURRENCY_CODES as readonly string[]).includes(body.currency.toUpperCase())) {
        throw new ApiValidationError(`Unsupported currency code. Supported: ${SUPPORTED_CURRENCY_CODES.join(', ')}`);
      }
    }

    // Validate code format (alphanumeric + hyphens/underscores)
    const codeRegex = /^[A-Za-z0-9_-]+$/;
    if (!codeRegex.test(body.code)) {
      throw new ApiValidationError('Coupon code can only contain letters, numbers, hyphens, and underscores');
    }

    if (body.code.length > 50) {
      throw new ApiValidationError('Coupon code must be 50 characters or less');
    }

    // Validate dates
    let startsAt = new Date().toISOString();
    if (body.starts_at) {
      const date = new Date(body.starts_at);
      if (isNaN(date.getTime())) {
        throw new ApiValidationError('Invalid starts_at date format');
      }
      startsAt = date.toISOString();
    }

    let expiresAt: string | null = null;
    if (body.expires_at) {
      const date = new Date(body.expires_at);
      if (isNaN(date.getTime())) {
        throw new ApiValidationError('Invalid expires_at date format');
      }
      if (date <= new Date(startsAt)) {
        throw new ApiValidationError('expires_at must be after starts_at');
      }
      expiresAt = date.toISOString();
    }

    // Validate name length
    if (body.name && body.name.length > 200) {
      throw new ApiValidationError('Coupon name must be 200 characters or less');
    }

    // Validate usage limits (null means unlimited)
    if (body.usage_limit_global !== undefined && body.usage_limit_global !== null) {
      if (!Number.isInteger(body.usage_limit_global) || body.usage_limit_global < 1 || body.usage_limit_global > 10000000) {
        throw new ApiValidationError('usage_limit_global must be a positive integer up to 10,000,000');
      }
    }

    if (body.usage_limit_per_user !== undefined) {
      if (!Number.isInteger(body.usage_limit_per_user) || body.usage_limit_per_user < 1 || body.usage_limit_per_user > 10000) {
        throw new ApiValidationError('usage_limit_per_user must be a positive integer up to 10,000');
      }
    }

    // Validate arrays
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
    }

    if (body.allowed_product_ids !== undefined) {
      if (!Array.isArray(body.allowed_product_ids)) {
        throw new ApiValidationError('allowed_product_ids must be an array');
      }
      if (body.allowed_product_ids.length > 100) {
        throw new ApiValidationError('allowed_product_ids cannot exceed 100 entries');
      }
    }

    // Validate each product ID in allowed_product_ids
    if (Array.isArray(body.allowed_product_ids)) {
      for (const pid of body.allowed_product_ids) {
        const pidValidation = validateUUID(String(pid));
        if (!pidValidation.isValid) {
          throw new ApiValidationError(`Invalid product ID format in allowed_product_ids: ${pid}`);
        }
      }
    }

    // Insert coupon
    const { data: newCoupon, error: insertError } = await supabase
      .from('coupons')
      .insert({
        code: body.code.toUpperCase().trim(),
        name: body.name?.trim() || null,
        discount_type: body.discount_type,
        discount_value: discountValue,
        currency: body.currency || null,
        is_active: body.is_active ?? true,
        is_public: body.is_public ?? false,
        starts_at: startsAt,
        expires_at: expiresAt,
        usage_limit_global: body.usage_limit_global || null,
        usage_limit_per_user: body.usage_limit_per_user ?? 1,
        allowed_emails: body.allowed_emails || [],
        allowed_product_ids: body.allowed_product_ids || [],
        exclude_order_bumps: body.exclude_order_bumps ?? false,
      })
      .select(COUPON_API_FIELDS)
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return apiError(request, 'CONFLICT', 'Coupon code already exists');
      }
      console.error('Error creating coupon:', insertError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create coupon');
    }

    return jsonResponse(successResponse(newCoupon), request, 201);
  } catch (error) {
    return handleApiError(error, request);
  }
}
