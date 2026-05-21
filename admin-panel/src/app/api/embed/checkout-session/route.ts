import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

import {
  buildEmbedCorsHeaders,
  buildEmbedReturnUrl,
  embedJson,
  loadAllowedOriginsForProduct,
  parseEmbedCheckoutBody,
  requireEmbedCaptcha,
} from '@/lib/embed/checkout-embed';
import { checkRateLimit } from '@/lib/rate-limiting';
import { getCaptchaConfig } from '@/lib/captcha/config';
import { CheckoutError, CheckoutErrorType } from '@/types/checkout';
import { CheckoutService } from '@/lib/services/checkout';
import { createAdminClient } from '@/lib/supabase/admin';

const PRODUCT_SELECT =
  'id, slug, name, price, currency, is_active, available_from, available_until, product_type, embed_enabled, seller_id' as const;

type EmbedProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  is_active: boolean;
  available_from: string | null;
  available_until: string | null;
  product_type: string;
  embed_enabled: boolean;
  seller_id: string | null;
};

export async function OPTIONS(request: NextRequest) {
  const adminClient = createAdminClient();
  const productSlug = request.nextUrl.searchParams.get('productSlug');
  const { allowedOrigins } = productSlug
    ? await loadEmbedContext(adminClient, productSlug)
    : { allowedOrigins: [] };
  const origin = request.headers.get('origin');

  if (!buildEmbedCorsHeaders(origin, allowedOrigins)['Access-Control-Allow-Origin']) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: buildEmbedCorsHeaders(origin, allowedOrigins),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const adminClient = createAdminClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return embedJson({ error: 'Invalid request' }, 400, origin, []);
  }

  const parsed = parseEmbedCheckoutBody(body);
  if (!parsed.ok) {
    return embedJson({ error: parsed.error }, 400, origin, []);
  }

  const { product, allowedOrigins } = await loadEmbedContext(adminClient, parsed.value.productSlug);

  if (!buildEmbedCorsHeaders(origin, allowedOrigins)['Access-Control-Allow-Origin']) {
    return embedJson({ error: 'Forbidden' }, 403, origin, allowedOrigins);
  }

  // 30 sessions per 5-minute sliding window per fingerprint. Bigger window
  // previously (20/300m = 5h) was too tight: a buyer who fat-fingers BLIK
  // a couple times legitimately hits 4-5 attempts, and the same fingerprint
  // covers everyone behind a NAT.
  const rateLimitOk = await checkRateLimit('embed_checkout_session', 30, 5);
  if (!rateLimitOk) {
    await logEmbedCheckoutEvent(adminClient, {
      productId: null,
      productSlug: parsed.value.productSlug,
      origin,
      email: parsed.value.email,
      action: 'paid_checkout',
      status: 'rate_limited',
    });
    return embedJson({ error: 'Too many requests' }, 429, origin, allowedOrigins);
  }

  if (!product || !isEmbeddableProduct(product)) {
    await logEmbedCheckoutEvent(adminClient, {
      productId: product?.id ?? null,
      productSlug: parsed.value.productSlug,
      origin,
      email: parsed.value.email,
      action: 'paid_checkout',
      status: 'denied',
    });
    return embedJson({ error: 'Product is not available' }, 404, origin, allowedOrigins);
  }

  if (product.price !== 0) {
    const captchaConfig = getCaptchaConfig();
    const captchaRequired = captchaConfig.provider !== 'none';

    // Two-step: SDK first posts without a token to learn the captcha config,
    // then re-posts with the verified token. Returning a structured response
    // keeps the front-end free of /api/runtime-config calls (which lack CORS
    // headers for the embed origin).
    if (captchaRequired && !parsed.value.turnstileToken) {
      return embedJson(
        {
          kind: 'paid_needs_captcha' as const,
          captcha: captchaConfig,
          product: {
            slug: product.slug,
            name: product.name,
            price: product.price,
            currency: product.currency,
          },
        },
        200,
        origin,
        allowedOrigins,
      );
    }

    const captchaFail = await requireEmbedCaptcha(
      parsed.value.turnstileToken,
      origin,
      allowedOrigins,
    );
    if (captchaFail) {
      await logEmbedCheckoutEvent(adminClient, {
        productId: product.id,
        productSlug: product.slug,
        origin,
        email: parsed.value.email,
        action: 'paid_checkout',
        status: 'denied',
      });
      return captchaFail;
    }
  }

  if (product.price === 0) {
    return embedJson(
      {
        kind: 'free' as const,
        product: {
          slug: product.slug,
          name: product.name,
          price: product.price,
          currency: product.currency,
        },
        captcha: getCaptchaConfig(),
      },
      200,
      origin,
      allowedOrigins,
    );
  }

  try {
    const checkout = new CheckoutService();
    const embedSessionId = randomUUID();
    const session = await checkout.createCheckoutSession(
      {
        productId: product.id,
        ...(parsed.value.email ? { email: parsed.value.email } : {}),
      },
      buildEmbedReturnUrl(product.slug),
      undefined,
      { embedSessionId },
    );

    await logEmbedCheckoutEvent(adminClient, {
      productId: product.id,
      productSlug: product.slug,
      origin,
      email: parsed.value.email,
      action: 'paid_checkout',
      status: 'session_created',
      embedSessionId,
      stripeSessionId: session.sessionId,
    });

    return embedJson(
      {
        kind: 'paid' as const,
        clientSecret: session.clientSecret,
        sessionId: session.sessionId,
        product: {
          slug: product.slug,
          name: product.name,
          price: product.price,
          currency: product.currency,
        },
      },
      200,
      origin,
      allowedOrigins,
    );
  } catch (error) {
    if (error instanceof CheckoutError) {
      await logEmbedCheckoutEvent(adminClient, {
        productId: product.id,
        productSlug: product.slug,
        origin,
        email: parsed.value.email,
        action: 'paid_checkout',
        status: 'failed',
      });
      return embedJson(
        {
          error: error.message,
          type: error.type,
        },
        error.statusCode,
        origin,
        allowedOrigins,
      );
    }

    await logEmbedCheckoutEvent(adminClient, {
      productId: product.id,
      productSlug: product.slug,
      origin,
      email: parsed.value.email,
      action: 'paid_checkout',
      status: 'failed',
    });
    return embedJson(
      {
        error: 'Failed to create checkout session',
        type: CheckoutErrorType.UNKNOWN_ERROR,
      },
      500,
      origin,
      allowedOrigins,
    );
  }
}

async function loadEmbedContext(
  adminClient: ReturnType<typeof createAdminClient>,
  productSlug: string,
): Promise<{ product: EmbedProduct | null; allowedOrigins: string[] }> {
  const { data, error } = await adminClient
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('slug', productSlug)
    .maybeSingle();

  if (error || !data) return { product: null, allowedOrigins: [] };

  const product = data as EmbedProduct;
  const allowedOrigins = await loadAllowedOriginsForProduct(adminClient, product.seller_id);
  return { product, allowedOrigins };
}

function isEmbeddableProduct(product: EmbedProduct): boolean {
  const now = new Date();
  const availableFrom = product.available_from ? new Date(product.available_from) : null;
  const availableUntil = product.available_until ? new Date(product.available_until) : null;

  return (
    product.embed_enabled === true &&
    product.is_active === true &&
    product.product_type === 'one_time' &&
    (!availableFrom || availableFrom <= now) &&
    (!availableUntil || availableUntil > now)
  );
}

async function logEmbedCheckoutEvent(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    productId: string | null;
    productSlug: string;
    origin: string | null;
    email?: string;
    action: 'paid_checkout';
    status: 'session_created' | 'denied' | 'failed' | 'rate_limited';
    stripeSessionId?: string;
    embedSessionId?: string;
  },
): Promise<void> {
  try {
    await adminClient.from('embed_checkout_log').insert({
      action: input.action,
      status: input.status,
      product_id: input.productId,
      product_slug: input.productSlug,
      origin: input.origin,
      email: input.email ?? null,
      embed_session_id: input.embedSessionId ?? null,
      stripe_session_id: input.stripeSessionId ?? null,
    });
  } catch {
    // Logging must not block checkout creation.
  }
}
