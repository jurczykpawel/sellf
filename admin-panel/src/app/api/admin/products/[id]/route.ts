import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import {
  validateProductId,
  validateUpdateProduct,
  sanitizeProductData
} from '@/lib/validations/product';

/**
 * Admin API for product management by ID
 * SECURITY: Admin only access with full validation
 */

// SECURITY: Origin-aware CORS — no wildcard for admin routes
function getAdminCorsOrigin(requestOrigin: string | null): string {
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (requestOrigin && (
    requestOrigin === siteUrl ||
    requestOrigin.startsWith('http://localhost:') ||
    requestOrigin.startsWith('http://127.0.0.1:')
  )) {
    return requestOrigin;
  }

  return siteUrl || 'null';
}

const getCorsHeaders = (requestOrigin: string | null) => ({
  'Access-Control-Allow-Origin': getAdminCorsOrigin(requestOrigin),
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
});

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');

  return new NextResponse(null, {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * GET /api/admin/products/[id] - Get product by ID
 * SECURITY: Admin only access
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // SECURITY: Verify admin access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: unknown) {
      const errorMessage = authError instanceof Error ? authError.message : 'Unauthorized';
      const status = errorMessage === 'Forbidden' ? 403 : 401;
      return NextResponse.json({ error: errorMessage }, { status, headers: corsHeaders });
    }
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Validate product ID
    const idValidation = validateProductId(id);
    if (!idValidation.isValid) {
      return NextResponse.json({ error: 'Invalid product ID', details: idValidation.errors }, { status: 400, headers: corsHeaders });
    }

    // Get product by ID
    const { data: product, error } = await (dataClient as any)
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404, headers: corsHeaders });
      }
      console.error('Error fetching product:', error);
      return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json(product, { headers: corsHeaders });
  } catch (error) {
    console.error('Error in GET /api/admin/products/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: getCorsHeaders(null) });
  }
}

/**
 * PUT /api/admin/products/[id] - Update product by ID
 * SECURITY: Admin only access, strict validation
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // SECURITY: Verify admin access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: unknown) {
      const errorMessage = authError instanceof Error ? authError.message : 'Unauthorized';
      const status = errorMessage === 'Forbidden' ? 403 : 401;
      return NextResponse.json({ error: errorMessage }, { status, headers: corsHeaders });
    }
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Validate product ID
    const idValidation = validateProductId(id);
    if (!idValidation.isValid) {
      return NextResponse.json({ error: 'Invalid product ID', details: idValidation.errors }, { status: 400, headers: corsHeaders });
    }

    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400, headers: corsHeaders });
    }

    // Extract categories
    const { categories, ...productDataRaw } = body;

    // Sanitize input data (setDefaults=false for partial updates)
    const sanitizedData = sanitizeProductData(productDataRaw, false);

    // Validate update data
    const validation = validateUpdateProduct(sanitizedData);

    if (!validation.isValid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400, headers: corsHeaders });
    }

    // Check if slug is unique (if being updated)
    if (sanitizedData.slug) {
      const { data: existingProduct, error: slugCheckError } = await (dataClient as any)
        .from('products')
        .select('id')
        .eq('slug', sanitizedData.slug)
        .neq('id', id)
        .maybeSingle();
      
      if (slugCheckError) {
        console.error('Error checking slug availability:', slugCheckError);
        return NextResponse.json({ error: 'Failed to check slug availability' }, { status: 500, headers: corsHeaders });
      }
      
      if (existingProduct) {
        return NextResponse.json({ error: 'A product with this slug already exists' }, { status: 400, headers: corsHeaders });
      }
    }

    // Update product
    const { data: updatedProduct, error } = await (dataClient as any)
      .from('products')
      .update(sanitizedData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404, headers: corsHeaders });
      }
      console.error('Error updating product:', error);
      return NextResponse.json({ error: 'Failed to update product' }, { status: 500, headers: corsHeaders });
    }

    // Update categories if present in request
    if (categories && Array.isArray(categories)) {
      const { error: deleteError } = await (dataClient as any)
        .from('product_categories')
        .delete()
        .eq('product_id', id);
      
      if (deleteError) {
        console.error('Error deleting old categories:', deleteError);
      } else if (categories.length > 0) {
        const categoryInserts = categories.map((catId: string) => ({
          product_id: id,
          category_id: catId
        }));
        
        const { error: insertError } = await (dataClient as any)
          .from('product_categories')
          .insert(categoryInserts);
          
        if (insertError) {
          console.error('Error inserting new categories:', insertError);
        }
      }
    }

    return NextResponse.json(updatedProduct, { headers: corsHeaders });
  } catch (error) {
    console.error('Error in PUT /api/admin/products/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: getCorsHeaders(null) });
  }
}

/**
 * DELETE /api/admin/products/[id] - Delete product by ID
 * SECURITY: Admin only access
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // SECURITY: Verify admin access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: unknown) {
      const errorMessage = authError instanceof Error ? authError.message : 'Unauthorized';
      const status = errorMessage === 'Forbidden' ? 403 : 401;
      return NextResponse.json({ error: errorMessage }, { status, headers: corsHeaders });
    }
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Validate product ID
    const idValidation = validateProductId(id);
    if (!idValidation.isValid) {
      return NextResponse.json({ error: 'Invalid product ID', details: idValidation.errors }, { status: 400, headers: corsHeaders });
    }

    // Check if product exists and has no active user accesses
    const { data: userAccesses, error: accessCheckError } = await (dataClient as any)
      .from('user_product_access')
      .select('id')
      .eq('product_id', id)
      .limit(1);

    if (accessCheckError) {
      console.error('Error checking product access:', accessCheckError);
      return NextResponse.json({ error: 'Failed to check product usage' }, { status: 500, headers: corsHeaders });
    }

    if (userAccesses && userAccesses.length > 0) {
      return NextResponse.json({ error: 'Cannot delete product with existing user accesses. Deactivate it instead.' }, { status: 400, headers: corsHeaders });
    }

    // Delete product
    const { error } = await (dataClient as any)
      .from('products')
      .delete()
      .eq('id', id);

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404, headers: corsHeaders });
      }
      console.error('Error deleting product:', error);
      return NextResponse.json({ error: 'Failed to delete product' }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json({ message: 'Product deleted successfully' }, { headers: corsHeaders });
  } catch (error) {
    console.error('Error in DELETE /api/admin/products/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: getCorsHeaders(null) });
  }
}
