/**
 * Order Bumps Management API
 *
 * Admin endpoints for managing order bump configurations
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

import { requireAdminOrSellerApi } from '@/lib/auth-server';
import type { OrderBumpFormData, OrderBumpAdmin } from '@/types/order-bump';

/**
 * GET /api/admin/order-bumps
 * List all order bumps or bumps for specific product
 *
 * Query params:
 * - productId: UUID of product to get bumps for (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);

    // Get query params
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');

    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    if (productId) {
      // Get bumps for specific product using database function
      const { data, error } = await dataClient.rpc('admin_get_product_order_bumps', {
        product_id_param: productId,
      });

      if (error) {
        console.error('Error fetching product order bumps:', error);
        return NextResponse.json(
          { error: 'Failed to fetch order bumps' },
          { status: 500 }
        );
      }

      return NextResponse.json(data || []);
    } else {
      // Use adminClient (seller_main schema) for FK embedding queries —
      // PostgREST can't resolve FK relationships through proxy views in public schema.
      const adminClient = await createDataClientFromAuth(authResult.sellerSchema);
      const { data, error } = await adminClient
        .from('order_bumps')
        .select(
          `
          id,
          main_product_id,
          bump_product_id,
          bump_price,
          bump_title,
          bump_description,
          is_active,
          display_order,
          access_duration_days,
          created_at,
          updated_at,
          main_product:products!order_bumps_main_product_id_fkey(id, name, slug),
          bump_product:products!order_bumps_bump_product_id_fkey(id, name, slug, price, currency)
        `
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

      if (error) {
        console.error('Error fetching all order bumps:', error);
        return NextResponse.json(
          { error: 'Failed to fetch order bumps' },
          { status: 500 }
        );
      }

      return NextResponse.json(data || []);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Order bumps GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/order-bumps
 * Create a new order bump configuration
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);

    // Parse request body
    const formData: OrderBumpFormData = await request.json();

    // Validate required fields
    if (
      !formData.main_product_id ||
      !formData.bump_product_id ||
      !formData.bump_title
    ) {
      return NextResponse.json(
        { error: 'Missing required fields: main_product_id, bump_product_id, bump_title' },
        { status: 400 }
      );
    }

    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    // Validate that products exist and are active
    const { data: mainProduct } = await dataClient
      .from('products')
      .select('id, is_active')
      .eq('id', formData.main_product_id)
      .single();

    if (!mainProduct || !mainProduct.is_active) {
      return NextResponse.json(
        { error: 'Main product not found or inactive' },
        { status: 400 }
      );
    }

    const { data: bumpProduct } = await dataClient
      .from('products')
      .select('id, is_active, price')
      .eq('id', formData.bump_product_id)
      .single();

    if (!bumpProduct || !bumpProduct.is_active) {
      return NextResponse.json(
        { error: 'Bump product not found or inactive' },
        { status: 400 }
      );
    }

    // Validate bump_price if provided
    if (formData.bump_price !== null && formData.bump_price < 0) {
      return NextResponse.json(
        { error: 'Bump price must be non-negative' },
        { status: 400 }
      );
    }

    // Create order bump
    const { data, error } = await dataClient
      .from('order_bumps')
      .insert({
        main_product_id: formData.main_product_id,
        bump_product_id: formData.bump_product_id,
        bump_price: formData.bump_price,
        bump_title: formData.bump_title,
        bump_description: formData.bump_description,
        is_active: formData.is_active ?? true,
        display_order: formData.display_order ?? 0,
        access_duration_days: formData.access_duration_days,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating order bump:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Order bump already exists for this product pair' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to create order bump' },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Order bumps POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
