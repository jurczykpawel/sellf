import { NextRequest, NextResponse } from 'next/server';

import {
  buildEmbedCorsHeaders,
  embedJson,
  loadAllowedOriginsForProduct,
  parseEmbedFreeAccessBody,
} from '@/lib/embed/checkout-embed';
import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const PRODUCT_SELECT =
  'id, slug, name, price, is_active, available_from, available_until, embed_enabled, seller_id' as const;

type FreeEmbedProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  is_active: boolean;
  available_from: string | null;
  available_until: string | null;
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

  const parsed = parseEmbedFreeAccessBody(body);
  if (!parsed.ok) {
    return embedJson({ error: parsed.error }, 400, origin, []);
  }

  const { product, allowedOrigins } = await loadEmbedContext(adminClient, parsed.value.productSlug);

  if (!buildEmbedCorsHeaders(origin, allowedOrigins)['Access-Control-Allow-Origin']) {
    return embedJson({ error: 'Forbidden' }, 403, origin, allowedOrigins);
  }

  if (parsed.value.honeypot) {
    // Always log the hit so operators can see ongoing abuse, even after
    // the bucket is exhausted. The response is identical on both paths
    // to avoid leaking rate-limit state to bots.
    await logEmbedFreeAccessEvent(adminClient, {
      productId: product?.id ?? null,
      productSlug: parsed.value.productSlug,
      origin,
      email: parsed.value.email,
      status: 'bot_filtered',
    });

    await checkRateLimit('embed_free_access_honeypot', 20, 300);

    return embedJson(
      {
        success: true,
        message: 'Check your email for the access link.',
      },
      200,
      origin,
      allowedOrigins,
    );
  }

  const rateLimitOk = await checkRateLimit('embed_free_access', 5, 300);
  if (!rateLimitOk) {
    return embedJson({ error: 'Too many requests' }, 429, origin, allowedOrigins);
  }

  if (!product || !isFreeEmbeddableProduct(product)) {
    return embedJson({ error: 'Product is not available' }, 404, origin, allowedOrigins);
  }

  const result = await requestMagicLink({
    flow: 'free_product',
    productSlug: product.slug,
    email: parsed.value.email,
    captchaToken: parsed.value.turnstileToken,
  });

  await logEmbedFreeAccessEvent(adminClient, {
    productId: product.id,
    productSlug: product.slug,
    origin,
    email: parsed.value.email,
    status: result.ok ? 'magic_link_sent' : 'failed',
  });

  if (!result.ok) {
    if (result.code === 'captcha_failed') {
      return embedJson(
        { error: 'Security verification failed. Please try again.' },
        400,
        origin,
        allowedOrigins,
      );
    }
    if (result.code === 'invalid_email') {
      return embedJson({ error: 'Invalid request' }, 400, origin, allowedOrigins);
    }
    if (result.code === 'rate_limited') {
      return embedJson({ error: 'Too many requests' }, 429, origin, allowedOrigins);
    }
    return embedJson({ error: 'Failed to send access link' }, 500, origin, allowedOrigins);
  }

  return embedJson(
    {
      success: true,
      message: 'Check your email for the access link.',
      productName: product.name,
    },
    200,
    origin,
    allowedOrigins,
  );
}

async function loadEmbedContext(
  adminClient: ReturnType<typeof createAdminClient>,
  productSlug: string,
): Promise<{ product: FreeEmbedProduct | null; allowedOrigins: string[] }> {
  const { data, error } = await adminClient
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('slug', productSlug)
    .maybeSingle();

  if (error || !data) return { product: null, allowedOrigins: [] };

  const product = data as FreeEmbedProduct;
  const allowedOrigins = await loadAllowedOriginsForProduct(adminClient, product.seller_id);
  return { product, allowedOrigins };
}

function isFreeEmbeddableProduct(product: FreeEmbedProduct): boolean {
  const now = new Date();
  const availableFrom = product.available_from ? new Date(product.available_from) : null;
  const availableUntil = product.available_until ? new Date(product.available_until) : null;

  return (
    product.embed_enabled === true &&
    product.is_active === true &&
    product.price === 0 &&
    (!availableFrom || availableFrom <= now) &&
    (!availableUntil || availableUntil > now)
  );
}

async function logEmbedFreeAccessEvent(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    productId: string | null;
    productSlug: string;
    origin: string | null;
    email: string;
    status: 'magic_link_sent' | 'failed' | 'bot_filtered';
  },
): Promise<void> {
  try {
    await adminClient.from('embed_checkout_log').insert({
      action: 'free_email_gate',
      status: input.status,
      product_id: input.productId,
      product_slug: input.productSlug,
      origin: input.origin,
      email: input.email,
    });
  } catch {
    // Logging must not block free access delivery.
  }
}
