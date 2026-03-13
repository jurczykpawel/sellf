import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WebhookService } from '@/lib/services/webhook-service';
import { checkRateLimit } from '@/lib/rate-limiting';
import { sanitizeForLog } from '@/lib/logger';
import { verifyCaptchaToken } from '@/lib/captcha/verify';

export async function POST(request: Request) {
  try {
    // SECURITY: Reject non-JSON Content-Type to prevent blind CSRF via text/plain forms
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 }
      );
    }

    // Rate limiting: 5 requests per 5 minutes (prevents webhook spam)
    const rateLimitOk = await checkRateLimit('waitlist_signup', 5, 300);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again in a few minutes.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email, productId, productSlug, captchaToken } = body;

    // Validate required fields
    if (!email || !productId) {
      return NextResponse.json(
        { error: 'Email and product ID are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate productId is a UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof productId !== 'string' || !UUID_REGEX.test(productId)) {
      return NextResponse.json(
        { error: 'Invalid product ID format' },
        { status: 400 }
      );
    }

    // Verify captcha in production
    if (process.env.NODE_ENV === 'production') {
      const captchaResult = await verifyCaptchaToken(captchaToken);
      if (!captchaResult.success) {
        return NextResponse.json(
          { error: captchaResult.error || 'Security verification failed' },
          { status: 400 },
        );
      }
    }

    const supabase = await createClient();

    // Fetch product details
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, slug, price, currency, icon, enable_waitlist')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Verify waitlist is enabled for this product
    if (!product.enable_waitlist) {
      return NextResponse.json(
        { error: 'Waitlist is not enabled for this product' },
        { status: 400 }
      );
    }

    // Trigger webhook for waitlist signup
    // Note: We're not storing in DB yet - that will be added later (see backlog)
    await WebhookService.trigger('waitlist.signup', {
      customer: {
        email
      },
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug || productSlug,
        price: product.price,
        currency: product.currency,
        icon: product.icon,
      }
    });

    // Log the signup for debugging (can be removed in production)
    console.log(`[Waitlist] New signup: ${sanitizeForLog(email)} for product ${sanitizeForLog(product.name)} (${product.id})`);

    return NextResponse.json({
      success: true,
      message: 'Successfully signed up for waitlist',
    });
  } catch (error) {
    console.error('[Waitlist] Error processing signup:', error);
    return NextResponse.json(
      { error: 'Failed to process waitlist signup' },
      { status: 500 }
    );
  }
}
