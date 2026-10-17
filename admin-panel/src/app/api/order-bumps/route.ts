/**
 * Public Order Bumps API
 *
 * GET /api/order-bumps?productId={uuid}
 * Fetch active order bumps for a product (public, used by checkout page)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 60 requests per minute (prevents scraping)
    const rateLimitOk = await checkRateLimit('order_bumps', 60, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');

    if (!productId) {
      return NextResponse.json(
        { error: 'productId query parameter is required' },
        { status: 400 }
      );
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return NextResponse.json(
        { error: 'Invalid productId format' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Call database function to get active order bumps
    const { data, error } = await supabase.rpc('get_product_order_bumps', {
      product_id_param: productId,
    });

    if (error) {
      console.error('Error fetching order bumps:', error);
      return NextResponse.json(
        { error: 'Failed to fetch order bumps' },
        { status: 500 }
      );
    }

    const bumps = data || [];
    if (bumps.length === 0) return NextResponse.json([]);

    // Add each bump product's VAT settings (three non-sensitive columns, ids come from
    // the RPC above) so the checkout total uses the same per-line rules as the charge.
    const { data: vatRows } = await createAdminClient()
      .from('products')
      .select('id, vat_rate, price_includes_vat, vat_exempt')
      .in('id', bumps.map((b: { bump_product_id: string }) => b.bump_product_id));
    const vatById = new Map((vatRows ?? []).map((r) => [r.id, r]));
    return NextResponse.json(
      bumps.map((b: { bump_product_id: string }) => {
        const v = vatById.get(b.bump_product_id);
        return { ...b, vat_rate: v?.vat_rate ?? null, price_includes_vat: v?.price_includes_vat ?? null, vat_exempt: v?.vat_exempt ?? null };
      })
    );
  } catch (error) {
    console.error('Order bumps API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
