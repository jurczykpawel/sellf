/**
 * Variant Groups API v1 - Single Group Operations
 *
 * GET /api/v1/variant-groups/[id] - Get a variant group
 * PATCH /api/v1/variant-groups/[id] - Update a variant group
 * DELETE /api/v1/variant-groups/[id] - Delete a variant group
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

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/variant-groups/[id]
 *
 * Get a single variant group with its products.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);

    const { id: groupId } = await context.params;

    const idValidation = validateUUID(groupId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid group ID format');
    }

    // Get the variant group
    const { data: group, error: groupError } = await supabase
      .from('variant_groups')
      .select('id, name, slug, is_active, created_at, updated_at')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      return apiError(request, 'NOT_FOUND', 'Variant group not found');
    }

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
      .eq('group_id', groupId)
      .order('display_order', { ascending: true });

    if (pgError) {
      console.error('Error fetching product variant groups:', pgError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch products');
    }

    return jsonResponse(
      successResponse({
        ...group,
        products: (productGroups || []).map(pg => ({
          id: pg.id,
          product_id: pg.product_id,
          group_id: pg.group_id,
          variant_name: pg.variant_name,
          display_order: pg.display_order,
          is_featured: pg.is_featured,
          created_at: pg.created_at,
          product: pg.products
        }))
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/variant-groups/[id]
 *
 * Update a variant group.
 *
 * Body:
 * - name: string (optional)
 * - slug: string (optional)
 * - products: Array<{ product_id, variant_name?, display_order, is_featured? }> (optional)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const { id: groupId } = await context.params;

    const idValidation = validateUUID(groupId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid group ID format');
    }

    // Check if group exists
    const { data: existingGroup, error: fetchError } = await supabase
      .from('variant_groups')
      .select('id')
      .eq('id', groupId)
      .single();

    if (fetchError || !existingGroup) {
      return apiError(request, 'NOT_FOUND', 'Variant group not found');
    }

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const { name, slug, is_active, products } = body as {
      name?: string;
      slug?: string;
      is_active?: boolean;
      products?: Array<{
        product_id: string;
        variant_name?: string;
        display_order: number;
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
    if (slug !== undefined && slug && String(slug).length > 100) {
      return apiError(request, 'VALIDATION_ERROR', 'Slug too long', {
        slug: ['Slug must be 100 characters or less']
      });
    }

    // Validate slug format if provided
    if (slug !== undefined && slug && !/^[a-z0-9_-]+$/.test(slug)) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid slug format', {
        slug: ['Slug must contain only lowercase letters, numbers, hyphens, and underscores']
      });
    }

    // Update group name, slug and/or is_active if provided
    if (name !== undefined || slug !== undefined || is_active !== undefined) {
      const updates: { name?: string | null; slug?: string | null; is_active?: boolean } = {};
      if (name !== undefined) updates.name = name || null;
      if (slug !== undefined) updates.slug = slug || null;
      if (is_active !== undefined) updates.is_active = is_active;

      const { error: updateError } = await supabase
        .from('variant_groups')
        .update(updates)
        .eq('id', groupId);

      if (updateError) {
        console.error('Error updating group:', updateError);
        if (updateError.code === '23505') {
          return apiError(request, 'CONFLICT', 'Slug already exists');
        }
        return apiError(request, 'INTERNAL_ERROR', 'Failed to update group');
      }
    }

    // Update products if provided
    if (products && products.length > 50) {
      return apiError(request, 'VALIDATION_ERROR', 'Too many products', {
        products: ['A variant group can have at most 50 products']
      });
    }

    if (products && products.length > 0) {
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
        // Validate display_order if provided
        if (p.display_order !== undefined) {
          if (typeof p.display_order !== 'number' || !Number.isInteger(p.display_order) || p.display_order < 0 || p.display_order > 1000) {
            return apiError(request, 'VALIDATION_ERROR', 'Invalid display order', {
              products: ['display_order must be an integer between 0 and 1000']
            });
          }
        }
      }

      // Delete existing product-group relationships
      const { error: deleteError } = await supabase
        .from('product_variant_groups')
        .delete()
        .eq('group_id', groupId);

      if (deleteError) {
        console.error('Error deleting old product relationships:', deleteError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to update products');
      }

      // Insert new relationships
      const productGroupEntries = products.map((p, index) => ({
        product_id: p.product_id,
        group_id: groupId,
        variant_name: p.variant_name || null,
        display_order: p.display_order ?? index,
        is_featured: p.is_featured || false
      }));

      const { error: insertError } = await supabase
        .from('product_variant_groups')
        .insert(productGroupEntries);

      if (insertError) {
        console.error('Error inserting new product relationships:', insertError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to update products');
      }
    }

    // Fetch updated group with products (matching GET response shape)
    const { data: updatedGroup, error: refetchError } = await supabase
      .from('variant_groups')
      .select('id, name, slug, is_active, created_at, updated_at')
      .eq('id', groupId)
      .single();

    if (refetchError) {
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch updated group');
    }

    const { data: productGroups } = await supabase
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
      .eq('group_id', groupId)
      .order('display_order', { ascending: true });

    return jsonResponse(successResponse({
      ...updatedGroup,
      products: (productGroups || []).map(pg => ({
        id: pg.id,
        product_id: pg.product_id,
        group_id: pg.group_id,
        variant_name: pg.variant_name,
        display_order: pg.display_order,
        is_featured: pg.is_featured,
        created_at: pg.created_at,
        product: pg.products
      }))
    }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/variant-groups/[id]
 *
 * Delete a variant group.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const { id: groupId } = await context.params;

    const idValidation = validateUUID(groupId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid group ID format');
    }

    // Check if group exists
    const { data: existingGroup, error: fetchError } = await supabase
      .from('variant_groups')
      .select('id')
      .eq('id', groupId)
      .single();

    if (fetchError || !existingGroup) {
      return apiError(request, 'NOT_FOUND', 'Variant group not found');
    }

    // Delete the group (cascade will delete product_variant_groups entries)
    const { error } = await supabase
      .from('variant_groups')
      .delete()
      .eq('id', groupId);

    if (error) {
      console.error('Error deleting variant group:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete variant group');
    }

    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
