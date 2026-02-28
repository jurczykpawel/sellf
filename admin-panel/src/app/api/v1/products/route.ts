/**
 * Products API v1 - List and Create
 *
 * GET /api/v1/products - List products with cursor-based pagination
 * POST /api/v1/products - Create a new product
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
  parseLimit,
  createPaginationResponse,
  applyCursorToQuery,
  validateCursor,
  API_SCOPES,
} from '@/lib/api';
import {
  validateCreateProduct,
  sanitizeProductData,
  escapeIlikePattern,
  validateProductSortColumn,
  validateUUID,
  PRODUCT_API_FIELDS,
} from '@/lib/validations/product';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/products
 *
 * Query parameters:
 * - cursor: Pagination cursor (optional)
 * - limit: Items per page, max 100 (default: 20)
 * - search: Search in name and description (optional)
 * - status: Filter by status - 'active', 'inactive', 'all' (default: 'all')
 * - sort_by: Sort field - 'created_at', 'name', 'price', etc. (default: 'created_at')
 * - sort_order: Sort direction - 'asc' or 'desc' (default: 'desc')
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const sortByRaw = searchParams.get('sort_by') || 'created_at';
    const sortOrder = searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Validate sort column
    const sortBy = validateProductSortColumn(sortByRaw);

    // Build query - fetch limit + 1 to check for more
    let query = supabase
      .from('products')
      .select(PRODUCT_API_FIELDS);

    // Apply search filter
    if (search) {
      const escapedSearch = escapeIlikePattern(search);
      query = query.or(`name.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`);
    }

    // Apply status filter
    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    }

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, sortBy, sortOrder);

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    // Secondary sort by ID for consistent ordering
    query = query.order('id', { ascending: sortOrder === 'asc' });

    // Fetch limit + 1 to check for more
    query = query.limit(limit + 1);

    const { data: products, error } = await query;

    if (error) {
      console.error('Error fetching products:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch products');
    }

    // Create pagination response
    const { items, pagination } = createPaginationResponse(
      products || [],
      limit,
      sortBy,
      sortOrder,
      cursor
    );

    return jsonResponse(successResponse(items, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * POST /api/v1/products
 *
 * Create a new product.
 *
 * Request body:
 * - name: string (required)
 * - slug: string (required)
 * - description: string (required)
 * - price: number (required)
 * - currency: string (optional, default: 'USD')
 * - is_active: boolean (optional, default: true)
 * - is_featured: boolean (optional, default: false)
 * - icon: string (optional, default: '📦')
 * - content_delivery_type: 'content' | 'redirect' | 'download' (optional, default: 'content')
 * - content_config: object (optional)
 * - available_from: string ISO date (optional)
 * - available_until: string ISO date (optional)
 * - auto_grant_duration_days: number (optional)
 * - categories: string[] (optional, array of category IDs)
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    // Parse request body
    const body = await parseJsonBody<Record<string, unknown>>(request);

    // Extract categories separately
    const { categories, ...productDataRaw } = body;

    // Sanitize input
    const sanitizedData = sanitizeProductData(productDataRaw, true);

    // Validate input
    const validation = validateCreateProduct(sanitizedData);
    if (!validation.isValid) {
      throw new ApiValidationError('Validation failed', {
        _errors: validation.errors,
      });
    }

    // Check slug uniqueness
    const { data: existingProduct, error: slugCheckError } = await supabase
      .from('products')
      .select('id')
      .eq('slug', sanitizedData.slug)
      .maybeSingle();

    if (slugCheckError) {
      console.error('Error checking slug:', slugCheckError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to validate slug');
    }

    if (existingProduct) {
      return apiError(request, 'ALREADY_EXISTS', 'A product with this slug already exists');
    }

    // Create product
    const { data: product, error: createError } = await supabase
      .from('products')
      .insert([sanitizedData])
      .select(PRODUCT_API_FIELDS)
      .single();

    if (createError) {
      console.error('Error creating product:', createError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create product');
    }

    // Add categories if provided
    if (product && Array.isArray(categories) && categories.length > 0) {
      for (const catId of categories) {
        const catValidation = validateUUID(String(catId));
        if (!catValidation.isValid) {
          return apiError(request, 'VALIDATION_ERROR', `Invalid category ID format: ${catId}`);
        }
      }

      const categoryInserts = categories.map((catId: unknown) => ({
        product_id: product.id,
        category_id: String(catId),
      }));

      const { error: catError } = await supabase
        .from('product_categories')
        .insert(categoryInserts);

      if (catError) {
        console.error('Error adding categories:', catError);
        // Don't fail the request, just log the error
      }
    }

    return jsonResponse(successResponse(product), request, 201);
  } catch (error) {
    return handleApiError(error, request);
  }
}
