import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/products/[id]/oto
 * Get OTO configuration for a product
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: productId } = await context.params;

    const supabase = await createClient();

    // Check admin access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: unknown) {
      const errorMessage = authError instanceof Error ? authError.message : 'Unauthorized';
      const status = errorMessage === 'Forbidden' ? 403 : 401;
      return NextResponse.json({ error: errorMessage }, { status });
    }
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    // Fetch OTO configuration via RPC
    const { data, error } = await (dataClient as any).rpc('admin_get_product_oto_offer', {
      product_id_param: productId
    });

    if (error) {
      console.error('Failed to fetch OTO config:', error);
      return NextResponse.json({ has_oto: false });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('OTO config API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/products/[id]/oto
 * Save OTO configuration for a product
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: productId } = await context.params;
    const body = await request.json();

    const {
      oto_enabled,
      oto_product_id,
      oto_discount_type,
      oto_discount_value,
      oto_duration_minutes,
    } = body;

    // Validate types for fields that will be forwarded to RPC
    if (typeof oto_enabled !== 'boolean' && oto_enabled !== undefined) {
      return NextResponse.json({ error: 'oto_enabled must be a boolean' }, { status: 400 });
    }
    if (oto_product_id !== undefined && (typeof oto_product_id !== 'string' || !oto_product_id)) {
      return NextResponse.json({ error: 'oto_product_id must be a non-empty string' }, { status: 400 });
    }
    const ALLOWED_DISCOUNT_TYPES = ['percentage', 'fixed'] as const;
    if (oto_discount_type !== undefined && !ALLOWED_DISCOUNT_TYPES.includes(oto_discount_type)) {
      return NextResponse.json({ error: 'oto_discount_type must be "percentage" or "fixed"' }, { status: 400 });
    }
    if (oto_discount_value !== undefined && (typeof oto_discount_value !== 'number' || oto_discount_value < 0)) {
      return NextResponse.json({ error: 'oto_discount_value must be a non-negative number' }, { status: 400 });
    }
    if (oto_duration_minutes !== undefined && (typeof oto_duration_minutes !== 'number' || oto_duration_minutes < 1)) {
      return NextResponse.json({ error: 'oto_duration_minutes must be a positive number' }, { status: 400 });
    }

    const supabase = await createClient();

    // Check admin access
    let authResult;
    try {
      authResult = await requireAdminOrSellerApi(supabase);
    } catch (authError: unknown) {
      const errorMessage = authError instanceof Error ? authError.message : 'Unauthorized';
      const status = errorMessage === 'Forbidden' ? 403 : 401;
      return NextResponse.json({ error: errorMessage }, { status });
    }
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    if (oto_enabled && oto_product_id) {
      // Save OTO configuration
      const { data, error } = await (dataClient as any).rpc('admin_save_oto_offer', {
        source_product_id_param: productId,
        oto_product_id_param: oto_product_id,
        discount_type_param: oto_discount_type || 'percentage',
        discount_value_param: oto_discount_value || 20,
        duration_minutes_param: oto_duration_minutes || 15,
        is_active_param: true
      });

      if (error) {
        console.error('Failed to save OTO config:', error);
        return NextResponse.json({ error: 'Failed to save OTO configuration' }, { status: 500 });
      }

      return NextResponse.json(data);
    } else {
      // Delete OTO configuration
      const { data, error } = await (dataClient as any).rpc('admin_delete_oto_offer', {
        source_product_id_param: productId
      });

      if (error) {
        console.error('Failed to delete OTO config:', error);
        return NextResponse.json({ error: 'Failed to delete OTO configuration' }, { status: 500 });
      }

      return NextResponse.json(data);
    }
  } catch (error) {
    console.error('OTO config save API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
