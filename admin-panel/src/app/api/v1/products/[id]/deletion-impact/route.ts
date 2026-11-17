/**
 * Products API v1 - what deleting a product would affect
 *
 * GET /api/v1/products/:id/deletion-impact - Counts of orders, invoices, licenses, buyer
 * accesses and subscriptions. `hasHistory: true` means DELETE archives the product.
 *
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql (product_deletion_impact)
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
import { validateProductId } from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const { id } = await params;

    if (!validateProductId(id).isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    const { data: product } = await supabase.from('products').select('id').eq('id', id).maybeSingle();
    if (!product) return apiError(request, 'NOT_FOUND', 'Product not found');

    const { data, error } = await supabase.rpc('product_deletion_impact', { p_product_id: id });
    if (error) {
      console.error('[products.deletion-impact]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to check product history');
    }
    return jsonResponse(successResponse(data), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
