import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { isValidEmailFormat } from '@/lib/validations/email-format';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

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

    // 1. Rate Limiting
    const allowed = await checkRateLimit('coupon_auto_apply', 10, 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { email, productId } = await readJsonBody<{ email?: string; productId?: string }>(request);

    if (!email || typeof email !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'Email and Product ID are required' }, { status: 400 });
    }
    if (!UUID_REGEX.test(productId)) {
      return NextResponse.json({ error: 'Invalid Product ID format' }, { status: 400 });
    }
    if (!isValidEmailFormat(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Signed-in buyers are matched by their account e-mail (the database
    // function reads it from the session); guests by the e-mail they typed,
    // looked up server-side after the per-client limit above.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const lookupClient = user ? supabase : createAdminClient();

    const { data, error } = await lookupClient.rpc('find_auto_apply_coupon', {
      customer_email_param: user?.email ?? email,
      product_id_param: productId
    });

    if (error) {
      console.error('Auto-apply lookup error:', error);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    console.error('Auto-apply API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
