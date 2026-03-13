import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { verifyPaymentSession } from '@/lib/payment/verify-payment';

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

    const { session_id } = await request.json();
    
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
    
    // Rate limiting - use user ID if available, otherwise use client IP
    const rateLimitIdentifier = user?.id || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimitOk = await checkRateLimit('verify_payment', 10, 60, rateLimitIdentifier);
    
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Use the unified payment verification function
    const result = await verifyPaymentSession(session_id, user);

    // Handle errors
    if (result.error) {
      if (result.error === 'Invalid session ID') {
        return NextResponse.json(result, { status: 400 });
      }
      if (result.error === 'Session does not belong to current user') {
        return NextResponse.json(result, { status: 403 });
      }
      if (result.error === 'Session not found') {
        return NextResponse.json(result, { status: 404 });
      }
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Payment verification API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
