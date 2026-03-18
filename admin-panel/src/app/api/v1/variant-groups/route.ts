/**
 * Variant Groups API v1
 *
 * GET /api/v1/variant-groups - List all variant groups
 * POST /api/v1/variant-groups - Create a new variant group
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
import { validateUUID } from '@/lib/validations/product';

interface ProductInGroup {
  id: string;
  product_id: string;
  group_id: string;
  variant_name: string | null;
  display_order: number;
  is_featured: boolean;
  created_at: string;
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    currency: string;
    icon: string | null;
    is_active: boolean;
  };
}

interface VariantGroupWithProducts {
  id: string;
  name: string | null;
  slug: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  products: ProductInGroup[];
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/variant-groups
 *
 * List variant groups with their products (cursor-based pagination).
 *
 * Query parameters:
 * - cursor: Pagination cursor (optional)
 * - limit: Items per page, max 100 (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));

    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build paginated query for groups
    let query = supabase
      .from('variant_groups')
      .select('id, name, slug, is_active, created_at, updated_at');

    query = applyCursorToQuery(query, cursor, 'created_at', 'desc');
    query = query.order('created_at', { ascending: false });
    query = query.order('id', { ascending: false });
    query = query.limit(limit + 1);

    const { data: groups, error: groupsError } = await query;

    if (groupsError) {
      console.error('Error fetching variant groups:', groupsError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch variant groups');
    }

    const { items: paginatedGroups, pagination } = createPaginationResponse(
      (groups || []) as Record<string, unknown>[],
      limit,
      'created_at',
      'desc',
      cursor
    );

    // Get product relationships for the paginated groups
    const groupIds = paginatedGroups.map(g => g.id as string);

    let groupsWithProducts: VariantGroupWithProducts[] = [];

    if (groupIds.length > 0) {
      const { data: productGroups, error: pgError } = await supabase
        .from('product_variant_groups')
        .select(`
          id,
          product_id,
          group_id,
          variant_name,
          display_order,
          is_featured,
          created_at,
          products:product_id (
            id,
            name,
            slug,
            price,
            currency,
            icon,
            is_active
          )
        `)
        .in('group_id', groupIds)
        .order('display_order', { ascending: true });

      if (pgError) {
        console.error('Error fetching product variant groups:', pgError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch product variant groups');
      }

      groupsWithProducts = paginatedGroups.map(group => ({
        ...(group as unknown as VariantGroupWithProducts),
        products: (productGroups || [])
          .filter(pg => pg.group_id === group.id)
          .map(pg => ({
            id: pg.id,
            product_id: pg.product_id,
            group_id: pg.group_id,
            variant_name: pg.variant_name,
            display_order: pg.display_order,
            is_featured: pg.is_featured,
            created_at: pg.created_at,
            product: pg.products as unknown as ProductInGroup['product']
          }))
          .sort((a, b) => a.display_order - b.display_order)
      }));
    }

    return jsonResponse(successResponse(groupsWithProducts, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * POST /api/v1/variant-groups
 *
 * Create a new variant group.
 *
 * Body:
 * - name: string (optional) - Group name
 * - slug: string (optional) - URL slug
 * - products: Array<{ product_id: string, variant_name?: string, is_featured?: boolean }> (required)
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const { name, slug, is_active, products } = body as {
      name?: string;
      slug?: string;
      is_active?: boolean;
      products: Array<{
        product_id: string;
        variant_name?: string;
        is_featured?: boolean;
      }>;
    };

    // Validate name length if provided
    if (name !== undefined && name && String(name).length > 200) {
      return apiError(request, 'VALIDATION_ERROR', 'Group name too long', {
        name: ['Name must be 200 characters or less']
      });
    }

    // Validate slug length if provided
    if (slug && String(slug).length > 100) {
      return apiError(request, 'VALIDATION_ERROR', 'Slug too long', {
        slug: ['Slug must be 100 characters or less']
      });
    }

    // Validate required field
    if (!products || products.length < 2) {
      return apiError(request, 'VALIDATION_ERROR', 'At least 2 products are required', {
        products: ['At least 2 products are required to create a variant group']
      });
    }

    // Validate products array upper bound
    if (products.length > 50) {
      return apiError(request, 'VALIDATION_ERROR', 'Too many products', {
        products: ['A variant group can have at most 50 products']
      });
    }

    // Validate slug format if provided
    if (slug && !/^[a-z0-9_-]+$/.test(slug)) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid slug format', {
        slug: ['Slug must contain only lowercase letters, numbers, hyphens, and underscores']
      });
    }

    // Validate product entries
    for (const p of products) {
      const uuidValidation = validateUUID(p.product_id);
      if (!uuidValidation.isValid) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid product ID format', {
          products: [`Invalid UUID format for product_id: ${p.product_id}`]
        });
      }
      // Validate variant_name if provided
      if (p.variant_name !== undefined && p.variant_name !== null) {
        if (typeof p.variant_name !== 'string' || p.variant_name.length > 200) {
          return apiError(request, 'VALIDATION_ERROR', 'Invalid variant name', {
            products: ['variant_name must be a string of 200 characters or less']
          });
        }
      }
    }

    // Create the variant group
    const { data: newGroup, error: groupError } = await supabase
      .from('variant_groups')
      .insert({ name: name || null, slug: slug || null, is_active: is_active !== false })
      .select('id, name, slug, is_active, created_at, updated_at')
      .single();

    if (groupError || !newGroup) {
      console.error('Error creating variant group:', groupError);
      // Check for unique constraint violation (duplicate slug)
      if (groupError?.code === '23505') {
        return apiError(request, 'CONFLICT', 'Slug already exists');
      }
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create variant group');
    }

    // Add products to the group
    const productGroupEntries = products.map((p, index) => ({
      product_id: p.product_id,
      group_id: newGroup.id,
      variant_name: p.variant_name || null,
      display_order: index,
      is_featured: p.is_featured || false
    }));

    const { error: pgError } = await supabase
      .from('product_variant_groups')
      .insert(productGroupEntries);

    if (pgError) {
      // Rollback: delete the group
      await supabase.from('variant_groups').delete().eq('id', newGroup.id);
      console.error('Error adding products to group:', pgError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to add products to variant group');
    }

    return jsonResponse(
      successResponse({
        id: newGroup.id,
        name: newGroup.name,
        slug: newGroup.slug,
        created_at: newGroup.created_at,
        updated_at: newGroup.updated_at,
        products_count: products.length
      }),
      request,
      201
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
