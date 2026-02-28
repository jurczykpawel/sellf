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
      .select('id, name, slug, created_at, updated_at')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      return apiError(request, 'NOT_FOUND', 'Variant group not found');
    }

    // Get products in this group
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
    const { name, slug, products } = body as {
      name?: string;
      slug?: string;
      products?: Array<{
        product_id: string;
        variant_name?: string;
        display_order: number;
        is_featured?: boolean;
      }>;
    };

    // Validate slug format if provided
    if (slug !== undefined && slug && !/^[a-z0-9_-]+$/.test(slug)) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid slug format', {
        slug: ['Slug must contain only lowercase letters, numbers, hyphens, and underscores']
      });
    }

    // Update group name and/or slug if provided
    if (name !== undefined || slug !== undefined) {
      const updates: { name?: string | null; slug?: string | null } = {};
      if (name !== undefined) updates.name = name || null;
      if (slug !== undefined) updates.slug = slug || null;

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
    if (products && products.length > 0) {
      // Validate product UUIDs
      for (const p of products) {
        const uuidValidation = validateUUID(p.product_id);
        if (!uuidValidation.isValid) {
          return apiError(request, 'VALIDATION_ERROR', 'Invalid product ID format', {
            products: [`Invalid UUID format for product_id: ${p.product_id}`]
          });
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
      .select('id, name, slug, created_at, updated_at')
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
