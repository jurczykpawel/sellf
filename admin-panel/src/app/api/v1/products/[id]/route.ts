/**
 * Products API v1 - Single Product Operations
 *
 * GET /api/v1/products/:id - Get product by ID
 * PATCH /api/v1/products/:id - Update product
 * DELETE /api/v1/products/:id - Delete product
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
import {
  validateProductId,
  validateUpdateProduct,
  validateUUID,
  sanitizeProductData,
  PRODUCT_API_FIELDS,
} from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/products/:id
 *
 * Retrieve a single product by ID.
 * Includes product categories if any.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateProductId(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    // Fetch product with categories
    const { data: product, error } = await supabase
      .from('products')
      .select(`
        ${PRODUCT_API_FIELDS},
        product_categories (
          category_id,
          categories (
            id,
            name,
            slug
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Product not found');
      }
      console.error('Error fetching product:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch product');
    }

    // Transform product_categories to simpler structure
    const categories = product.product_categories?.map(
      (pc: { category_id: unknown; categories: unknown }) =>
        pc.categories
    ) || [];

    const productWithCategories = {
      ...product,
      categories,
      product_categories: undefined,
    };
    delete productWithCategories.product_categories;

    return jsonResponse(successResponse(productWithCategories), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/products/:id
 *
 * Update a product. Only provided fields will be updated.
 *
 * Request body:
 * - name: string (optional)
 * - slug: string (optional)
 * - description: string (optional)
 * - price: number (optional)
 * - currency: string (optional)
 * - is_active: boolean (optional)
 * - is_featured: boolean (optional)
 * - icon: string (optional)
 * - content_delivery_type: string (optional)
 * - content_config: object (optional)
 * - available_from: string ISO date (optional)
 * - available_until: string ISO date (optional)
 * - auto_grant_duration_days: number (optional)
 * - categories: string[] (optional, replaces existing categories)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateProductId(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    // Parse request body
    const body = await parseJsonBody<Record<string, unknown>>(request);

    // Extract categories separately
    const { categories, ...productDataRaw } = body;

    // Sanitize input (setDefaults: false for partial updates)
    const sanitizedData = sanitizeProductData(productDataRaw, false);

    // Validate input
    const validation = validateUpdateProduct(sanitizedData);
    if (!validation.isValid) {
      throw new ApiValidationError('Validation failed', {
        _errors: validation.errors,
      });
    }

    // If slug is being changed, check uniqueness
    if (sanitizedData.slug) {
      const { data: existingProduct, error: slugCheckError } = await supabase
        .from('products')
        .select('id')
        .eq('slug', sanitizedData.slug)
        .neq('id', id)
        .maybeSingle();

      if (slugCheckError) {
        console.error('Error checking slug:', slugCheckError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to validate slug');
      }

      if (existingProduct) {
        return apiError(request, 'ALREADY_EXISTS', 'A product with this slug already exists');
      }
    }

    // Check product exists before update
    const { data: existingCheck, error: existsError } = await supabase
      .from('products')
      .select('id')
      .eq('id', id)
      .single();

    if (existsError || !existingCheck) {
      return apiError(request, 'NOT_FOUND', 'Product not found');
    }

    // Update product (only if there are fields to update)
    let product = existingCheck;
    if (Object.keys(sanitizedData).length > 0) {
      const { data: updatedProduct, error: updateError } = await supabase
        .from('products')
        .update(sanitizedData)
        .eq('id', id)
        .select(PRODUCT_API_FIELDS)
        .single();

      if (updateError) {
        console.error('Error updating product:', updateError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to update product');
      }
      product = updatedProduct;
    } else {
      // If no fields to update, fetch the current product
      const { data: currentProduct, error: fetchError } = await supabase
        .from('products')
        .select(PRODUCT_API_FIELDS)
        .eq('id', id)
        .single();

      if (fetchError) {
        console.error('Error fetching product:', fetchError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch product');
      }
      product = currentProduct;
    }

    // Update categories if provided
    if (Array.isArray(categories)) {
      // Delete existing categories
      const { error: deleteError } = await supabase
        .from('product_categories')
        .delete()
        .eq('product_id', id);

      if (deleteError) {
        console.error('Error deleting categories:', deleteError);
        // Don't fail the request
      }

      // Insert new categories
      if (categories.length > 0) {
        for (const catId of categories) {
          const catValidation = validateUUID(String(catId));
          if (!catValidation.isValid) {
            return apiError(request, 'VALIDATION_ERROR', `Invalid category ID format: ${catId}`);
          }
        }

        const categoryInserts = categories.map((catId: unknown) => ({
          product_id: id,
          category_id: String(catId),
        }));

        const { error: catError } = await supabase
          .from('product_categories')
          .insert(categoryInserts);

        if (catError) {
          console.error('Error adding categories:', catError);
          // Don't fail the request
        }
      }
    }

    // Re-fetch with categories to match GET response shape
    const { data: productWithCats } = await supabase
      .from('products')
      .select(`
        ${PRODUCT_API_FIELDS},
        product_categories (
          category_id,
          categories (
            id,
            name,
            slug
          )
        )
      `)
      .eq('id', id)
      .single();

    if (productWithCats) {
      const cats = productWithCats.product_categories?.map(
        (pc: { category_id: unknown; categories: unknown }) => pc.categories
      ) || [];
      const result = { ...productWithCats, categories: cats, product_categories: undefined };
      delete result.product_categories;
      return jsonResponse(successResponse(result), request);
    }

    return jsonResponse(successResponse(product), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * DELETE /api/v1/products/:id
 *
 * Delete a product. This is a soft operation that respects database constraints.
 * Products with active user access or payments may fail to delete.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateProductId(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    }

    // Check product exists
    const { data: existingProduct, error: checkError } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', id)
      .single();

    if (checkError || !existingProduct) {
      return apiError(request, 'NOT_FOUND', 'Product not found');
    }

    // Delete product categories first (due to FK constraints)
    const { error: catDeleteError } = await supabase
      .from('product_categories')
      .delete()
      .eq('product_id', id);

    if (catDeleteError) {
      console.error('Error deleting product categories:', catDeleteError);
      // Continue anyway - might not have any categories
    }

    // Delete product
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting product:', deleteError);

      // Check for foreign key constraint violations
      if (deleteError.code === '23503') {
        return apiError(
          request,
          'CONFLICT',
          'Cannot delete product with existing user access or payments'
        );
      }

      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete product');
    }

    // Return 204 No Content on successful deletion
    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
