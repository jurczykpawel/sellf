/**
 * Products API v1 - restore from the archive
 *
 * POST /api/v1/products/:id/restore - Move an archived product back to the product list.
 * The product stays inactive until the seller activates it.
 *
 * @see supabase/migrations/20261114100000_product_archive.sql (restore_product_as)
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateProductId, PRODUCT_API_FIELDS } from '@/lib/validations/product';
import { accessActor } from '@/lib/services/business-events';
import { invalidatePublicProducts } from '@/lib/storefront-templates/invalidation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { supabase, admin } = auth;
    const { id } = await params;

    if (!validateProductId(id).isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    const { error: restoreError } = await supabase.rpc('restore_product_as', {
      event_actor: { ...accessActor(auth) },
      p_product_id: id,
      actor_id: admin.userId,
    });
    if (restoreError) {
      if (restoreError.code === 'P0002') return apiError(request, 'NOT_FOUND', 'Product not found');
      console.error('[products.restore]', restoreError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to restore product');
    }

    const { data: product, error } = await supabase.from('products').select(PRODUCT_API_FIELDS).eq('id', id).single();
    if (error || !product) {
      console.error('[products.restore]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch product');
    }
    invalidatePublicProducts(id, product.slug, true);
    return jsonResponse(successResponse(product), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
