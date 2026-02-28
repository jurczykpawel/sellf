/**
 * Products API v1 - OTO (One-Time Offer) Configuration
 *
 * GET /api/v1/products/[id]/oto - Get OTO configuration
 * PUT /api/v1/products/[id]/oto - Save/Update OTO configuration
 * DELETE /api/v1/products/[id]/oto - Delete OTO configuration
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
import { validateProductId, validateUUID } from '@/lib/validations/product';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/products/[id]/oto
 *
 * Get OTO configuration for a product.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);

    const { id: productId } = await context.params;

    const idValidation = validateProductId(productId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    // Check if source product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return apiError(request, 'NOT_FOUND', 'Product not found');
    }

    // Fetch OTO configuration
    const { data: otoOffer, error } = await supabase
      .from('oto_offers')
      .select(`
        id,
        source_product_id,
        oto_product_id,
        discount_type,
        discount_value,
        duration_minutes,
        is_active,
        created_at,
        updated_at,
        oto_product:products!oto_offers_oto_product_id_fkey(id, name, slug, price, currency)
      `)
      .eq('source_product_id', productId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch OTO config:', error);
      return jsonResponse(successResponse({ has_oto: false }), request);
    }

    if (!otoOffer) {
      return jsonResponse(successResponse({ has_oto: false }), request);
    }

    return jsonResponse(successResponse({
      has_oto: true,
      oto_product_id: otoOffer.oto_product_id,
      discount_type: otoOffer.discount_type,
      discount_value: otoOffer.discount_value,
      duration_minutes: otoOffer.duration_minutes,
      oto_product: otoOffer.oto_product,
    }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PUT /api/v1/products/[id]/oto
 *
 * Save or update OTO configuration for a product.
 *
 * Body:
 * - oto_product_id: string (required) - The product to offer as OTO
 * - discount_type: 'percentage' | 'fixed' (default: 'percentage')
 * - discount_value: number (default: 20, max: 100 for percentage, 999999.99 for fixed)
 * - duration_minutes: number (default: 15, max: 10080 = 7 days)
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const { id: productId } = await context.params;

    const idValidation = validateProductId(productId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const {
      oto_product_id,
      discount_type = 'percentage',
      discount_value = 20,
      duration_minutes = 15,
    } = body;

    // Validate required field
    if (!oto_product_id) {
      return apiError(request, 'VALIDATION_ERROR', 'oto_product_id is required', {
        oto_product_id: ['OTO product ID is required']
      });
    }

    // Validate OTO product ID format
    const otoIdValidation = validateUUID(String(oto_product_id));
    if (!otoIdValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid OTO product ID format');
    }

    // Validate discount type
    if (!['percentage', 'fixed'].includes(discount_type as string)) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid discount type', {
        discount_type: ['Must be "percentage" or "fixed"']
      });
    }

    // Validate discount value
    if (typeof discount_value !== 'number' || discount_value < 0) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid discount value', {
        discount_value: ['Must be a non-negative number']
      });
    }
    if (discount_type === 'percentage' && discount_value > 100) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid discount value', {
        discount_value: ['Percentage discount cannot exceed 100']
      });
    }
    if (discount_type === 'fixed' && discount_value > 999999.99) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid discount value', {
        discount_value: ['Fixed discount cannot exceed 999999.99']
      });
    }

    // Validate duration
    if (typeof duration_minutes !== 'number' || !Number.isInteger(duration_minutes) || duration_minutes < 1 || duration_minutes > 10080) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid duration', {
        duration_minutes: ['Must be between 1 and 10080 minutes (7 days)']
      });
    }

    // Prevent self-reference
    if (String(oto_product_id) === productId) {
      return apiError(request, 'VALIDATION_ERROR', 'OTO product cannot be the same as source product', {
        oto_product_id: ['OTO product cannot be the same as source product']
      });
    }

    // Check if source product exists
    const { data: sourceProduct, error: sourceError } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .single();

    if (sourceError || !sourceProduct) {
      return apiError(request, 'NOT_FOUND', 'Source product not found');
    }

    // Check if OTO product exists
    const { data: otoProduct, error: otoError } = await supabase
      .from('products')
      .select('id')
      .eq('id', String(oto_product_id))
      .single();

    if (otoError || !otoProduct) {
      return apiError(request, 'VALIDATION_ERROR', 'OTO product not found', {
        oto_product_id: ['OTO product not found']
      });
    }

    // Upsert OTO configuration
    // First, deactivate any existing OTO for this source product
    await supabase
      .from('oto_offers')
      .update({ is_active: false })
      .eq('source_product_id', productId);

    // Then insert new OTO offer
    const { data, error } = await supabase
      .from('oto_offers')
      .insert({
        source_product_id: productId,
        oto_product_id: String(oto_product_id),
        discount_type,
        discount_value,
        duration_minutes,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to save OTO config:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to save OTO configuration');
    }

    return jsonResponse(successResponse({
      has_oto: true,
      oto_product_id: data.oto_product_id,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      duration_minutes: data.duration_minutes,
    }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/products/[id]/oto
 *
 * Delete OTO configuration for a product (soft delete — sets is_active to false).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);

    const { id: productId } = await context.params;

    const idValidation = validateProductId(productId);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    // Deactivate OTO offers for this source product
    const { error } = await supabase
      .from('oto_offers')
      .update({ is_active: false })
      .eq('source_product_id', productId);

    if (error) {
      console.error('Failed to delete OTO config:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete OTO configuration');
    }

    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
