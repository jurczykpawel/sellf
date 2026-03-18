/**
 * User Access Management — internal API for admin panel UI
 *
 * Used by: AccessManagementModal component (session/cookie auth)
 * Data source: user_product_access_detailed view + user_product_access table
 *
 * NOT the same as /api/v1/users/:id/access which supports API key auth
 * with scopes, pagination, and standardized response format.
 *
 * Access: platform_admin, seller_admin (schema-scoped via requireAdminOrSellerApi)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import {
  validateGrantAccess,
  sanitizeGrantAccessData
} from '@/lib/validations/access';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

// GET /api/users/[id]/access - Get user's product access
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();

    // Verify admin or seller access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: any) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = createDataClientFromAuth(authResult.sellerSchema);

    // Get user's product access using adminClient to access restricted view
    const { data: userAccess, error: accessError } = await adminClient
      .from('user_product_access_detailed')
      .select(`
        id,
        product_id,
        product_name,
        product_description,
        product_price,
        product_currency,
        product_is_active,
        access_created_at,
        access_granted_at,
        access_expires_at,
        access_duration_days,
        product_slug
      `)
      .eq('user_id', userId)
      .order('access_created_at', { ascending: false });

    if (accessError) {
      console.error('Error fetching user access:', accessError);
      return NextResponse.json({ error: 'Failed to fetch user access' }, { status: 500 });
    }

    return NextResponse.json({
      user_id: userId,
      access: userAccess || []
    });
  } catch (error) {
    console.error('Error in GET /api/users/[id]/access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/users/[id]/access - Grant user access to a product
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();

    // Verify admin or seller access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: any) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const adminUser = authResult.user;

    const body = await request.json();
    const adminClient = createDataClientFromAuth(authResult.sellerSchema);

    // Sanitize input data
    const sanitizedData = sanitizeGrantAccessData(body);

    // Validate input data
    const validation = validateGrantAccess(sanitizedData);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: validation.errors 
      }, { status: 400 });
    }

    // Validate request body
    const productId = sanitizedData.product_id as string;
    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Check if product exists using adminClient
    const { data: product, error: productError } = await adminClient
      .from('products')
      .select('id, name, is_active')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (!product.is_active) {
      return NextResponse.json({ error: 'Cannot grant access to inactive product' }, { status: 400 });
    }

    // Check if user already has access using adminClient
    const { data: existingAccess, error: existingError } = await adminClient
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error checking existing access:', existingError);
      return NextResponse.json({ error: 'Failed to check existing access' }, { status: 500 });
    }

    if (existingAccess) {
      return NextResponse.json({ error: 'User already has access to this product' }, { status: 409 });
    }

    // Grant access using adminClient
    const accessData: any = {
      user_id: userId,
      product_id: sanitizedData.product_id as string,
      created_at: new Date().toISOString()
    };

    if (sanitizedData.access_duration_days) {
      accessData.access_duration_days = sanitizedData.access_duration_days as number;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + (sanitizedData.access_duration_days as number));
      accessData.access_expires_at = expirationDate.toISOString();
    } else if (sanitizedData.access_expires_at) {
      accessData.access_expires_at = sanitizedData.access_expires_at as string;
    }

    const { data: newAccess, error: accessError } = await adminClient
      .from('user_product_access')
      .insert(accessData)
      .select('id, product_id, created_at, access_expires_at, access_duration_days')
      .single();

    if (accessError) {
      console.error('Error granting access:', accessError);
      return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 });
    }

    // Audit log: admin granted access (audit_log is in public schema)
    const platformClient = createPlatformClient();
    await platformClient.from('audit_log').insert({
      table_name: 'user_product_access',
      operation: 'INSERT',
      performed_by: adminUser.id,
      user_id: userId,
      new_values: { product_id: productId, product_name: product.name, action: 'admin_grant_access' },
    }).then(() => {}, (err: unknown) => console.error('[audit] Failed to log grant:', err));

    return NextResponse.json({
      message: 'Access granted successfully',
      access: newAccess
    }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/users/[id]/access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/users/[id]/access - Remove user's access to a product
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();

    // Verify admin or seller access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: any) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const adminUser = authResult.user;

    const adminClient = createDataClientFromAuth(authResult.sellerSchema);
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('product_id');

    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Check if access exists using adminClient
    const { data: existingAccess, error: existingError } = await adminClient
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (existingError || !existingAccess) {
      return NextResponse.json({ error: 'Access not found' }, { status: 404 });
    }

    // Remove access using adminClient
    const { error: deleteError } = await adminClient
      .from('user_product_access')
      .delete()
      .eq('id', existingAccess.id);

    if (deleteError) {
      console.error('Error removing access:', deleteError);
      return NextResponse.json({ error: 'Failed to remove access' }, { status: 500 });
    }

    // Audit log: admin revoked access (audit_log is in public schema)
    const platformClient = createPlatformClient();
    await platformClient.from('audit_log').insert({
      table_name: 'user_product_access',
      operation: 'DELETE',
      performed_by: adminUser.id,
      user_id: userId,
      old_values: { product_id: productId, action: 'admin_revoke_access' },
    }).then(() => {}, (err: unknown) => console.error('[audit] Failed to log revoke:', err));

    return NextResponse.json({
      message: 'Access removed successfully'
    });
  } catch (error) {
    console.error('Error in DELETE /api/users/[id]/access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}