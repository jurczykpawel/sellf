import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { validateEmailAction } from '@/lib/actions/validate-email';
import { verifyCaptchaToken } from '@/lib/captcha/verify';

/**
 * Helper to create CORS-enabled responses
 * Note: This is a public endpoint designed for embedding on external landing pages
 * CORS is intentionally permissive, but security is enforced via:
 * - Rate limiting
 * - Turnstile CAPTCHA
 * - Email validation
 * - Server-side product validation
 */
function corsResponse(data: any, status: number, origin: string | null): NextResponse {
  // In production, prefer explicit origin over wildcard for security
  const allowedOrigin = origin || '*';

  return NextResponse.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Don't allow credentials with wildcard origin
      ...(origin && origin !== '*' ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
    },
  });
}

/**
 * Public endpoint for claiming free products from external landing pages
 *
 * This endpoint allows embedding a form on external websites that:
 * 1. Validates the email and product
 * 2. Sends a magic link to the user
 * 3. Redirects to product access page after login
 *
 * Security:
 * - Rate limiting (anonymous based on IP)
 * - Turnstile verification (CAPTCHA)
 * - Email validation (disposable filter)
 * - Product validation (must be free, active, available)
 * - CORS enabled for embedding
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  try {
    const body = await request.json();
    const { email, productSlug, turnstileToken } = body;

    // Validate required fields
    if (!email || !productSlug) {
      return corsResponse(
        { error: 'Email and product slug are required' },
        400,
        origin
      );
    }

    // Rate limiting (anonymous, based on IP)
    const rateLimitOk = await checkRateLimit('claim_free_product_anonymous', 3, 300); // 3 requests per 5 minutes

    if (!rateLimitOk) {
      return corsResponse(
        { error: 'Too many requests. Please try again in a few minutes.' },
        429,
        origin
      );
    }

    // Verify captcha token (in production)
    if (process.env.NODE_ENV === 'production') {
      const captchaResult = await verifyCaptchaToken(turnstileToken);
      if (!captchaResult.success) {
        return corsResponse(
          { error: captchaResult.error || 'Security verification failed. Please try again.' },
          400,
          origin,
        );
      }
    }

    // Enhanced email validation with disposable domain checking
    try {
      const emailValidation = await validateEmailAction(email);
      if (!emailValidation.isValid) {
        return corsResponse(
          { error: emailValidation.error || 'Invalid or disposable email address not allowed' },
          400,
          origin
        );
      }
    } catch {
      return corsResponse(
        { error: 'Please enter a valid email address' },
        400,
        origin
      );
    }

    // Get product and validate
    const supabase = await createClient();
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, slug, price, is_active, available_from, available_until')
      .eq('slug', productSlug)
      .single();

    if (productError || !product) {
      return corsResponse(
        { error: 'Product not found' },
        404,
        origin
      );
    }

    // Verify product is free
    if (product.price > 0) {
      return corsResponse(
        { error: 'This product is not free' },
        400,
        origin
      );
    }

    // Check if product is active
    if (!product.is_active) {
      return corsResponse(
        { error: 'Product is not available' },
        400,
        origin
      );
    }

    // Check temporal availability
    const now = new Date();
    const availableFrom = product.available_from ? new Date(product.available_from) : null;
    const availableUntil = product.available_until ? new Date(product.available_until) : null;

    const isTemporallyAvailable =
      (!availableFrom || availableFrom <= now) &&
      (!availableUntil || availableUntil > now);

    if (!isTemporallyAvailable) {
      return corsResponse(
        { error: 'Product is not currently available' },
        400,
        origin
      );
    }

    // Send magic link via Supabase
    const redirectUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback?redirect_to=${encodeURIComponent(`/auth/product-access?product=${productSlug}`)}`;

    const { error: magicLinkError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl,
        data: {
          product_slug: productSlug, // Store in user metadata for later use
        },
      },
    });

    if (magicLinkError) {
      console.error('Magic link error:', magicLinkError);
      return corsResponse(
        { error: 'Failed to send magic link. Please try again.' },
        500,
        origin
      );
    }

    // Success response
    return corsResponse(
      {
        success: true,
        message: 'Check your email for the magic link to access your free product!',
        productName: product.name,
      },
      200,
      origin
    );

  } catch (error) {
    console.error('Error in claim-free endpoint:', error);
    return corsResponse(
      { error: 'Internal server error' },
      500,
      origin
    );
  }
}

// Enable CORS for embedding on external websites
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
