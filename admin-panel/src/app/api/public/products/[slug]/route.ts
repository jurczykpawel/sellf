import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const rateLimitOk = await checkRateLimit('public_product_slug', 60, 1);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const { slug } = await context.params;
    const sellerSlug = request.nextUrl.searchParams.get('seller');
    const supabase = await createClient();
    const { dataClient } = await resolvePublicDataClient(sellerSlug, supabase);

    // SECURITY FIX (V18): Only select public-safe fields
    const { data: product, error: productError } = await dataClient
      .from('products')
      .select(`
        id,
        name,
        slug,
        description,
        icon,
        price,
        currency,
        is_active,
        is_featured,
        available_from,
        available_until,
        allow_custom_price,
        custom_price_min,
        custom_price_presets,
        show_price_presets,
        enable_waitlist,
        content_delivery_type,
        layout_template
      `)
      .eq('slug', slug)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(product);

  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
