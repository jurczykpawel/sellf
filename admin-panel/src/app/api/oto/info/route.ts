import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';

/**
 * GET /api/oto/info
 * Returns OTO coupon information for frontend timer display
 *
 * Query params:
 * - code: OTO coupon code
 * - email: Customer email
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Rate Limiting - 10 requests per minute
    const allowed = await checkRateLimit('oto_info', 10, 1);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // 2. Get query parameters
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const email = searchParams.get('email');

    // 3. Validate inputs
    if (!code || !email) {
      return NextResponse.json(
        { valid: false, error: 'Code and email are required' },
        { status: 400 }
      );
    }

    if (code.length > 100 || email.length > 254) {
      return NextResponse.json(
        { valid: false, error: 'Invalid input length' },
        { status: 400 }
      );
    }

    // 4. Resolve marketplace seller → schema-scoped client
    const seller = searchParams.get('seller');
    const supabase = await createClient();
    const { dataClient } = await resolvePublicDataClient(seller, supabase);

    const { data, error } = await dataClient.rpc('get_oto_coupon_info', {
      coupon_code_param: code,
      email_param: email.toLowerCase()
    });

    if (error) {
      console.error('OTO info lookup error:', error);
      return NextResponse.json(
        { valid: false, error: 'Failed to fetch OTO info' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('OTO info API error:', error);
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
