import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';

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

    const { code, productId, email } = await request.json();

    // 1. Rate Limiting
    const allowed = await checkRateLimit('coupon_verify', 5, 60);
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

    const supabase = await createClient();

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('currency')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Use the secure DB function to verify coupon
    const { data, error } = await supabase.rpc('verify_coupon', {
      code_param: code.toUpperCase(),
      product_id_param: productId,
      customer_email_param: email || null,
      currency_param: product.currency,
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
