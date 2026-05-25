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
  parseEmbed,
  buildProductSelect,
  transformEmbeddedRelations,
} from '@/lib/api';
import { parseCsvFilter, resolveFilterIds, intersectProductIdsByMembership, quoteForPostgrestOr } from '@/lib/api/filters';
import { z } from 'zod';
import {
  validateCreateProduct,
  escapeIlikePattern,
  validateProductSortColumn,
  PRODUCT_API_FIELDS,
} from '@/lib/validations/product';
import { mapApiInputToProductRow, ProductCategoriesSchema, ProductTagsSchema } from '@/lib/api/dto/product';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

function intersectNullable(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
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
    const embed = parseEmbed(searchParams.get('embed'));

    // Validate search length early
    if (search && search.length > 200) {
      return apiError(request, 'INVALID_INPUT', 'Search query must be 200 characters or less');
    }
    const searchPattern = search ? quoteForPostgrestOr(`%${escapeIlikePattern(search)}%`) : null;

    const safeParse = (raw: string | null, label: string) => {
      try { return parseCsvFilter(raw); }
      catch (e) {
        return apiError(request, 'INVALID_INPUT', e instanceof Error ? e.message : `Invalid ${label}`);
      }
    };

    const categoryFilterRaw = safeParse(searchParams.get('category'), 'category');
    if (categoryFilterRaw instanceof Response) return categoryFilterRaw;
    const tagFilterRaw = safeParse(searchParams.get('tag'), 'tag');
    if (tagFilterRaw instanceof Response) return tagFilterRaw;

    const categoryIds = await resolveFilterIds(supabase, 'categories', categoryFilterRaw);
    const tagIds = await resolveFilterIds(supabase, 'tags', tagFilterRaw);
    if (categoryIds === null || tagIds === null) {
      return jsonResponse(successResponse([], { cursor: null, next_cursor: null, has_more: false, limit, total: 0 }), request);
    }

    const categoryProductIds = await intersectProductIdsByMembership(supabase, categoryIds, {
      junctionTable: 'product_categories',
      fkColumn: 'category_id',
    });
    const tagProductIds = await intersectProductIdsByMembership(supabase, tagIds, {
      junctionTable: 'product_tags',
      fkColumn: 'tag_id',
    });

    const filteredIds = intersectNullable(categoryProductIds, tagProductIds);
    if (filteredIds && filteredIds.length === 0) {
      return jsonResponse(successResponse([], { cursor: null, next_cursor: null, has_more: false, limit, total: 0 }), request);
    }

    // Count query (no cursor, no limit — accurate total for current filters)
    let countQuery = supabase
      .from('products')
      .select('id', { count: 'exact', head: true });
    if (searchPattern) {
      countQuery = countQuery.or(`name.ilike.${searchPattern},description.ilike.${searchPattern}`);
    }
    if (status === 'active') {
      countQuery = countQuery.eq('is_active', true);
    } else if (status === 'inactive') {
      countQuery = countQuery.eq('is_active', false);
    }
    if (filteredIds) countQuery = countQuery.in('id', filteredIds);
    const { count } = await countQuery;

    // Build main query - fetch limit + 1 to detect next page
    let query = supabase
      .from('products')
      .select(buildProductSelect(PRODUCT_API_FIELDS, embed));

    // Apply search filter
    if (searchPattern) {
      query = query.or(`name.ilike.${searchPattern},description.ilike.${searchPattern}`);
    }

    // Apply status filter
    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    }

    if (filteredIds) query = query.in('id', filteredIds);

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
      (products || []) as unknown as Record<string, unknown>[],
      limit,
      sortBy,
      sortOrder,
      cursor
    );

    const transformed = embed.size > 0
      ? (items as unknown[]).map((row) => transformEmbeddedRelations(row as unknown as Record<string, unknown>))
      : items;
    return jsonResponse(successResponse(transformed, { ...pagination, total: count ?? undefined }), request);
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
 * - categories: string[] (optional, array of category UUIDs, max 50)
 * - tags: string[] (optional, array of tag UUIDs, max 50)
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    // Parse request body
    const body = await parseJsonBody<Record<string, unknown>>(request);

    // Extract categories and tags separately
    const { categories: categoriesRaw, tags: tagsRaw, ...productDataRaw } = body;

    let categories: string[] | undefined;
    let tags: string[] | undefined;
    try {
      categories = ProductCategoriesSchema.parse(categoriesRaw);
      tags = ProductTagsSchema.parse(tagsRaw);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiValidationError('Validation failed', {
          _errors: err.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`),
        });
      }
      throw err;
    }

    let sanitizedData: Record<string, unknown>;
    try {
      sanitizedData = mapApiInputToProductRow(productDataRaw, 'create');
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiValidationError('Validation failed', {
          _errors: err.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`),
        });
      }
      throw err;
    }

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
      if (createError.code === '23505') {
        return apiError(request, 'ALREADY_EXISTS', 'A product with this slug already exists');
      }
      console.error('[products.POST]', createError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create product');
    }

    if (product && categories && categories.length > 0) {
      const { error: catError } = await supabase
        .from('product_categories')
        .insert(categories.map((category_id) => ({ product_id: product.id, category_id })));
      if (catError) console.error('[products.POST categories]', catError);
    }

    if (product && tags && tags.length > 0) {
      const { error: tagLinkErr } = await supabase
        .from('product_tags')
        .insert(tags.map((tag_id) => ({ product_id: product.id, tag_id })));
      if (tagLinkErr) console.error('[products.POST tags]', tagLinkErr);
    }

    const embed = parseEmbed('categories,tags');
    const { data: productWithRels, error: refetchErr } = await supabase
      .from('products')
      .select(buildProductSelect(PRODUCT_API_FIELDS, embed))
      .eq('id', product.id)
      .single();
    if (refetchErr) {
      console.error('[products.POST refetch]', refetchErr);
    }
    const result = productWithRels
      ? transformEmbeddedRelations(productWithRels as unknown as Record<string, unknown>)
      : product;
    return jsonResponse(successResponse(result), request, 201);
  } catch (error) {
    return handleApiError(error, request);
  }
}
