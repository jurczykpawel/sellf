import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import {
  validateCreateProduct,
  sanitizeProductData,
  escapeIlikePattern,
  validateProductSortColumn
} from '@/lib/validations/product';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

/**
 * Handle CORS preflight requests
 * SECURITY: Admin routes should only be accessed from the same origin
 */
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;

  // Only allow same-origin or configured site URL
  const allowedOrigin = origin && (
    origin === siteUrl ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  ) ? origin : (siteUrl || 'null');

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Helper function to get allowed CORS origin for admin routes
function getAdminCorsOrigin(requestOrigin: string | null): string {
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (requestOrigin && (
    requestOrigin === siteUrl ||
    (process.env.NODE_ENV === 'development' && (
      requestOrigin.startsWith('http://localhost:') ||
      requestOrigin.startsWith('http://127.0.0.1:')
    ))
  )) {
    return requestOrigin;
  }

  return siteUrl || 'null';
}

// Helper for standard headers - SECURITY: No wildcard CORS for admin routes
const getCorsHeaders = (requestOrigin: string | null) => ({
  'Access-Control-Allow-Origin': getAdminCorsOrigin(requestOrigin),
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
});

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase); // Enforce Admin Access
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Get search params
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const sortByRaw = searchParams.get('sortBy') || 'created_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // SECURITY FIX (V13): Validate sortBy to prevent SQL injection
    const sortBy = validateProductSortColumn(sortByRaw);

    // Build query
    let query = (dataClient as any)
      .from('products')
      .select('*', { count: 'exact' });

    // SECURITY FIX (V13): Escape ILIKE special characters to prevent pattern injection
    // Without escaping, attacker could use % or _ as wildcards in unexpected ways
    if (search) {
      const escapedSearch = escapeIlikePattern(search);
      query = query.or(`name.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`);
    }

    // Apply status filter
    const status = searchParams.get('status');
    if (status && status !== 'all') {
      query = query.eq('is_active', status === 'active');
    }

    // Apply sorting (sortBy is already validated)
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: products, error, count } = await query;

    if (error) {
      console.error('Error fetching products:', error);
      return NextResponse.json({ error: 'Failed to fetch products' }, { 
        status: 500,
        headers: corsHeaders
      });
    }

    return NextResponse.json({
      products,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    }, {
      headers: corsHeaders
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    console.error('Error in GET /api/products:', error);
    return NextResponse.json({ error: 'Internal server error' }, { 
      status: 500,
      headers: corsHeaders
    });
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase); // Enforce Admin Access
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { 
        status: 400,
        headers: corsHeaders
      });
    }

    // Extract categories
    const { categories, ...productDataRaw } = body;

    // Sanitize input data
    const sanitizedData = sanitizeProductData(productDataRaw);

    // Validate create data
    const validation = validateCreateProduct(sanitizedData);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: validation.errors 
      }, { 
        status: 400,
        headers: corsHeaders
      });
    }

    // Check if slug already exists
    const { data: existingProduct, error: slugCheckError } = await (dataClient as any)
      .from('products')
      .select('id')
      .eq('slug', sanitizedData.slug)
      .maybeSingle();
    
    if (slugCheckError) {
      console.error('Error checking slug availability:', slugCheckError);
      return NextResponse.json({ error: 'Failed to check slug availability' }, { 
        status: 500,
        headers: corsHeaders
      });
    }
    
    if (existingProduct) {
      return NextResponse.json({ error: 'A product with this slug already exists' }, { 
        status: 400,
        headers: corsHeaders
      });
    }

    // Insert product with sanitized data
    const { data: product, error } = await (dataClient as any)
      .from('products')
      .insert([sanitizedData])
      .select()
      .single();

    if (error) {
      console.error('Error creating product:', error);
      return NextResponse.json({ error: 'Failed to create product' }, { 
        status: 500,
        headers: corsHeaders
      });
    }

    // Insert categories if present
    if (product && categories && Array.isArray(categories) && categories.length > 0) {
      const categoryInserts = categories.map((catId: string) => ({
        product_id: product.id,
        category_id: catId
      }));
      
      const { error: catError } = await (dataClient as any)
        .from('product_categories')
        .insert(categoryInserts);
      
      if (catError) {
        console.error('Error adding categories:', catError);
        // We don't fail the whole request if categories fail, but we log it
      }
    }

    return NextResponse.json(product, { 
      status: 201,
      headers: corsHeaders
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    console.error('Error in POST /api/products:', error);
    return NextResponse.json({ error: 'Internal server error' }, { 
      status: 500,
      headers: corsHeaders
    });
  }
}