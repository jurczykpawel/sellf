/**
 * Public Order Bumps API
 *
 * GET /api/order-bumps?productId={uuid}
 * Fetch active order bumps for a product (public, used by checkout page)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

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

    // Marketplace: optional seller query param to scope to seller schema
    const sellerSlug = searchParams.get('seller');
    const defaultClient = await createClient();
    const { dataClient: client, seller } = await resolvePublicDataClient(sellerSlug, defaultClient);
    if (sellerSlug && !seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Call database function to get active order bumps
    const { data, error } = await client.rpc('get_product_order_bumps', {
      product_id_param: productId,
    });

    if (error) {
      console.error('Error fetching order bumps:', error);
      return NextResponse.json(
        { error: 'Failed to fetch order bumps' },
        { status: 500 }
      );
    }

    // Return empty array if no bumps found
    return NextResponse.json(data || []);
  } catch (error) {
    console.error('Order bumps API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
