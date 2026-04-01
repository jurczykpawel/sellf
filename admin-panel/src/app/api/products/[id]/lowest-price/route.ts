/**
 * API endpoint to get the lowest price for a product in the last 30 days
 * Implements EU Omnibus Directive (2019/2161) requirement
 * Only returns data if sale_price is active (public discount announcement)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLowestPriceInLast30Days, isSalePriceActive } from '@/lib/services/omnibus';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting: 60 requests per minute
    const rateLimitOk = await checkRateLimit('lowest_price', 60, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const params = await context.params;
    const productId = params.id;

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID is required' },
        { status: 400 }
      );
    }

    // Get product to check if sale_price is active (from seller schema if marketplace)
    const sellerSlug = request.nextUrl.searchParams.get('seller');
    const supabase = await createClient();
    const { dataClient } = await resolvePublicDataClient(sellerSlug, supabase);
    const { data: product, error: productError } = await dataClient
      .from('products')
      .select('sale_price, sale_price_until, sale_quantity_limit, sale_quantity_sold')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({
        lowestPrice: null,
        currency: null,
        effectiveFrom: null,
        showOmnibus: false,
      });
    }

    // Check if sale price is active (considers both time and quantity limits)
    const showOmnibus = isSalePriceActive(
      product.sale_price,
      product.sale_price_until,
      product.sale_quantity_limit,
      product.sale_quantity_sold
    );

    // Only fetch and return lowest price if sale is active
    if (!showOmnibus) {
      return NextResponse.json({
        lowestPrice: null,
        currency: null,
        effectiveFrom: null,
        showOmnibus: false,
      });
    }

    const result = await getLowestPriceInLast30Days(productId, dataClient);

    return NextResponse.json({
      lowestPrice: result?.lowestPrice ?? null,
      currency: result?.currency ?? null,
      effectiveFrom: result?.effectiveFrom ?? null,
      showOmnibus: true,
    });
  } catch (error) {
    console.error('Error fetching lowest price:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
