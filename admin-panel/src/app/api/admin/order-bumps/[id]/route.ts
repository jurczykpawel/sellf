/**
 * Order Bump Management API - Individual Bump Operations
 *
 * PATCH /api/admin/order-bumps/[id] - Update order bump
 * DELETE /api/admin/order-bumps/[id] - Delete order bump
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import type { OrderBumpFormData } from '@/types/order-bump';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/admin/order-bumps/[id]
 * Update an existing order bump
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Parse request body
    const updates: Partial<OrderBumpFormData> = await request.json();

    // Validate bump_price if provided
    if (updates.bump_price !== undefined && updates.bump_price !== null && updates.bump_price < 0) {
      return NextResponse.json(
        { error: 'Bump price must be non-negative' },
        { status: 400 }
      );
    }

    // Validate bump_product_id if changed
    if (updates.bump_product_id) {
      const { data: bumpProduct } = await (dataClient as any)
        .from('products')
        .select('id, is_active')
        .eq('id', updates.bump_product_id)
        .single();

      if (!bumpProduct || !bumpProduct.is_active) {
        return NextResponse.json(
          { error: 'Bump product not found or inactive' },
          { status: 400 }
        );
      }
    }

    // Update order bump
    const { data, error } = await (dataClient as any)
      .from('order_bumps')
      .update({
        ...(updates.bump_product_id && { bump_product_id: updates.bump_product_id }),
        ...(updates.bump_price !== undefined && { bump_price: updates.bump_price }),
        ...(updates.bump_title && { bump_title: updates.bump_title }),
        ...(updates.bump_description !== undefined && { bump_description: updates.bump_description }),
        ...(updates.is_active !== undefined && { is_active: updates.is_active }),
        ...(updates.display_order !== undefined && { display_order: updates.display_order }),
        ...(updates.access_duration_days !== undefined && { access_duration_days: updates.access_duration_days }),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating order bump:', error);

      // Handle not found
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Order bump not found' },
          { status: 404 }
        );
      }

      // Handle unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Order bump already exists for this product pair' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to update order bump' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Order bump PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/order-bumps/[id]
 * Delete an order bump
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Delete order bump
    const { error } = await (dataClient as any)
      .from('order_bumps')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting order bump:', error);

      // Handle not found
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Order bump not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to delete order bump' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Order bump DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
