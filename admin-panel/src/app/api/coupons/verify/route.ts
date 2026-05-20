import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOO_MANY = () => NextResponse.json({ error: 'Too many requests' }, { status: 429 });

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 }
      );
    }

    const { code, productId, email } = await request.json();

    if (!code || typeof code !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'Code and Product ID are required' }, { status: 400 });
    }
    if (!UUID_REGEX.test(productId)) {
      return NextResponse.json({ error: 'Invalid Product ID format' }, { status: 400 });
    }
    if (email !== undefined && email !== null && typeof email !== 'string') {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const normalisedCode = code.toUpperCase();

    // Layered throttling: per-code bucket prevents enumeration of the code space
    // through a botnet, per-source bucket keeps a single host from spamming.
    const perCode = await checkRateLimitForIdentifier(
      'coupon_verify_code',
      5,
      60,
      `code:${normalisedCode}`,
    );
    if (!perCode) return TOO_MANY();

    const perSource = await checkRateLimit('coupon_verify', 30, 60);
    if (!perSource) return TOO_MANY();

    const supabase = await createClient();

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('currency')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { data, error } = await supabase.rpc('verify_coupon', {
      code_param: normalisedCode,
      product_id_param: productId,
      customer_email_param: email || null,
      currency_param: product.currency,
    });

    if (error) {
      console.error('Coupon verification RPC error:', error);
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }

    if (!data || typeof data !== 'object' || !(data as { valid?: boolean }).valid) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Coupon verification API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
