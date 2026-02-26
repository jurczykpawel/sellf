import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';

export async function POST(request: NextRequest) {
  try {
    // 1. Rate Limiting
    const allowed = await checkRateLimit('coupon_auto_apply', 10, 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { email, productId } = await request.json();

    if (!email || typeof email !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'Email and Product ID are required' }, { status: 400 });
    }

    const supabase = await createClient();
    
    const { data, error } = await supabase.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: productId
    });

    if (error) {
      console.error('Auto-apply lookup error:', error);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Auto-apply API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
