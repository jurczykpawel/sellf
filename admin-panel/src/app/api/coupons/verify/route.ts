import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Reject non-JSON Content-Type to prevent blind CSRF via text/plain forms
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 }
      );
    }

    const { code, productId, email, sellerSlug } = await request.json();

    // 1. Rate Limiting — tighter for seller-scoped requests to prevent coupon enumeration
    const rateKey = sellerSlug ? `coupon_verify:${sellerSlug}` : 'coupon_verify';
    const rateMax = sellerSlug ? 3 : 5;
    const allowed = await checkRateLimit(rateKey, rateMax, 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    if (!code || typeof code !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'Code and Product ID are required' }, { status: 400 });
    }
    if (!UUID_REGEX.test(productId)) {
      return NextResponse.json({ error: 'Invalid Product ID format' }, { status: 400 });
    }
    if (email !== undefined && email !== null && typeof email !== 'string') {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Marketplace: optional sellerSlug to scope to seller schema
    const defaultClient = await createClient();
    const { dataClient: client, seller } = await resolvePublicDataClient(sellerSlug, defaultClient);
    if (sellerSlug && !seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Use the secure DB function to verify coupon
    const { data, error } = await client.rpc('verify_coupon', {
      code_param: code.toUpperCase(),
      product_id_param: productId,
      customer_email_param: email || null
    });

    if (error) {
      console.error('Coupon verification RPC error:', error);
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Coupon verification API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
