import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

import { requireAdminOrSellerApi } from '@/lib/auth-server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    const body = await request.json();

    // SECURITY FIX (V9): Whitelist allowed fields to prevent mass assignment
    // Fields like current_usage_count should NEVER be modifiable via API
    const allowedFields = [
      'code',
      'name',
      'discount_type',
      'discount_value',
      'is_active',
      'usage_limit_global',
      'usage_limit_per_user',
      'valid_from',
      'valid_until',
      'currency',
      'applicable_products',
      'minimum_order_amount',
      'exclude_order_bumps',
      'max_discount_amount',
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // Normalize code to uppercase
        if (field === 'code' && typeof body[field] === 'string') {
          updateData[field] = body[field].toUpperCase();
        } else {
          updateData[field] = body[field];
        }
      }
    }

    // Reject if no valid fields provided
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await dataClient
      .from('coupons')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Coupons PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    const { error } = await dataClient
      .from('coupons')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Coupons DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
