import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';

export async function POST(request: NextRequest) {
  try {
    // 1. Rate Limiting
    const allowed = await checkRateLimit('coupon_verify', 5, 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { code, productId, email } = await request.json();

    if (!code || typeof code !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'Code and Product ID are required' }, { status: 400 });
    }
    if (email !== undefined && email !== null && typeof email !== 'string') {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const supabase = await createClient();

    // Use the secure DB function to verify coupon
    const { data, error } = await supabase.rpc('verify_coupon', {
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
