import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSellerBySlug, createSellerAdminClient } from '@/lib/marketplace/seller-client';
import { checkRateLimit } from '@/lib/rate-limiting';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // 1. Rate Limiting
    const allowed = await checkRateLimit('coupon_auto_apply', 10, 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { email, productId, sellerSlug } = await request.json();

    if (!email || typeof email !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'Email and Product ID are required' }, { status: 400 });
    }
    if (!UUID_REGEX.test(productId)) {
      return NextResponse.json({ error: 'Invalid Product ID format' }, { status: 400 });
    }
    if (email.length > 254 || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Marketplace: scope coupon lookup to seller schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = await createClient();
    if (sellerSlug && typeof sellerSlug === 'string') {
      const seller = await getSellerBySlug(sellerSlug);
      if (seller) {
        client = createSellerAdminClient(seller.schema_name);
      }
    }

    const { data, error } = await client.rpc('find_auto_apply_coupon', {
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
