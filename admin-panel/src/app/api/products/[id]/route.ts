import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting: 60 requests per minute
    const rateLimitOk = await checkRateLimit('products_public', 60, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const { id } = await params;
    const sellerSlug = request.nextUrl.searchParams.get('seller');
    const supabase = await createClient();
    const { dataClient } = await resolvePublicDataClient(sellerSlug, supabase);

    // SECURITY FIX (V18): Only select public-safe fields
    const { data: product, error } = await dataClient
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
      .eq('id', id)
      .single();

    if (error || !product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ product });
  } catch (error: any) {
    console.error('Error fetching product:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    );
  }
}
