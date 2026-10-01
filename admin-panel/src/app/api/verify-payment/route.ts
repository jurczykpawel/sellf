import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { verifyPaymentSession, type PaymentVerificationResult } from '@/lib/payment/verify-payment';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

const ANONYMOUS_FIELDS = [
  'session_id',
  'status',
  'payment_status',
  'access_granted',
  'already_had_access',
  'requires_login',
  'is_guest_purchase',
  'scenario',
  'send_magic_link',
  'error',
] as const satisfies readonly (keyof PaymentVerificationResult)[];

function pickAnonymousFields(result: PaymentVerificationResult): Partial<PaymentVerificationResult> {
  return Object.fromEntries(
    ANONYMOUS_FIELDS.filter((key) => result[key] !== undefined).map((key) => [key, result[key]]),
  );
}

export async function POST(request: NextRequest) {
  try {
    // Reject non-JSON Content-Type to prevent blind CSRF via text/plain simple requests
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 }
      );
    }

    const { session_id } = await readJsonBody<{ session_id?: string }>(request);
    
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Validate session ID format (Stripe checkout session or payment intent)
    const isValidFormat = /^(cs_(test|live)_|pi_)[a-zA-Z0-9]+$/.test(session_id);
    if (!isValidFormat) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Get authenticated user (optional - can be null for guest purchases)
    const { data: { user } } = await supabase.auth.getUser();
    
    const rateLimitOk = await checkRateLimit('verify_payment', 10, 60, user?.id);
    
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Use the unified payment verification function
    const result = await verifyPaymentSession(session_id, user);

    // The session_id is the only credential here and it travels in URLs, so an
    // anonymous caller gets status + flow fields only (explicit allowlist). The
    // post-purchase page renders buyer details server-side via the lib function.
    const body = user ? result : pickAnonymousFields(result);

    // Handle errors
    if (result.error) {
      if (result.error === 'Invalid session ID') {
        return NextResponse.json(body, { status: 400 });
      }
      if (result.error === 'Session does not belong to current user') {
        return NextResponse.json(body, { status: 403 });
      }
      if (result.error === 'Session not found') {
        return NextResponse.json(body, { status: 404 });
      }
      return NextResponse.json(body, { status: 500 });
    }

    return NextResponse.json(body);

  } catch (error) {
    if (error instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    console.error('Payment verification API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
