import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CheckoutService } from '@/lib/services/checkout';
import { CheckoutError, CheckoutErrorType } from '@/types/checkout';
import { checkRateLimit } from '@/lib/rate-limiting';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import type { CreateCheckoutRequest, CreateCheckoutResponse, CheckoutErrorResponse } from '@/types/checkout';

export async function POST(request: NextRequest): Promise<NextResponse<CreateCheckoutResponse | CheckoutErrorResponse>> {
  try {
    const supabase = await createClient();

    // Get authenticated user first for rate limiting
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limiting: 20 requests per 5 minutes (prevents Stripe API abuse)
    const rateLimitOk = await checkRateLimit('create_embedded_checkout', 20, 300, user?.id);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please try again later.', type: CheckoutErrorType.UNKNOWN_ERROR },
        { status: 429 }
      );
    }

    // Reject non-JSON Content-Type to prevent blind CSRF via text/plain simple requests
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json', type: CheckoutErrorType.UNKNOWN_ERROR },
        { status: 415 }
      );
    }

    const requestData: CreateCheckoutRequest = await request.json();
    
    // Get origin for return URL — prefer server-side config over client-supplied Origin header
    // SECURITY: Origin header is client-supplied and could be manipulated
    const origin = process.env.NEXT_PUBLIC_BASE_URL || process.env.SITE_URL || request.headers.get('origin');
    
    // Use user's email from session if not provided in request
    const finalEmail = requestData.email || user?.email;
    
    // Create modified request with final email
    const finalRequestData = {
      ...requestData,
      email: finalEmail
    };
    
    // Create checkout service and process request
    const checkoutService = new CheckoutService();
    await checkoutService.initialize();

    // Validate request before any DB calls
    await checkoutService.validateRequest(finalRequestData);

    // Get product for return URL
    const product = await checkoutService.getProduct(finalRequestData.productId);
    
    // Use the same return URL for both logged-in and guest users
    // The payment-status page will handle both scenarios intelligently
    let returnUrl = `${origin}/p/${product.slug}/payment-status?session_id={CHECKOUT_SESSION_ID}`;
    
    // Append success_url if provided (for OTO/Funnels) — validate to prevent open redirects
    if (finalRequestData.successUrl) {
      if (!isSafeRedirectUrl(finalRequestData.successUrl)) {
        return NextResponse.json(
          { error: 'Invalid success URL', type: CheckoutErrorType.UNKNOWN_ERROR },
          { status: 400 }
        );
      }
      returnUrl += `&success_url=${encodeURIComponent(finalRequestData.successUrl)}`;
    }
    
    const result = await checkoutService.createCheckoutSession(
      finalRequestData,
      returnUrl,
      user?.id
    );
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Create embedded checkout error:', error);
    
    // Handle known checkout errors
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.message, type: error.type },
        { status: error.statusCode }
      );
    }
    
    // Handle unexpected errors
    return NextResponse.json(
      { error: 'Failed to create checkout session', type: CheckoutErrorType.UNKNOWN_ERROR },
      { status: 500 }
    );
  }
}
