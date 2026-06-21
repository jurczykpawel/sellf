/**
 * POST /api/legal/generate
 *
 * Generates and publishes legal documents (Terms of Service + Privacy Policy)
 * for the shop by calling the external legal-engine service, then stores them
 * in Supabase Storage and updates shop_config with the new public URLs.
 *
 * SECURITY:
 * - Admin-only: requires authenticated admin session (requireAdminApi)
 * - Service-role Supabase client used for all data operations after auth check
 * - External fetch uses redirect:'error' (SSRF protection, enforced in client.ts)
 *
 * Atomicity: shop_config URLs are updated ONLY after BOTH documents are
 * successfully rendered AND published. Any failure rolls back — existing URLs
 * are never overwritten on partial success.
 *
 * @see /lib/legal/client.ts    — renderDocument (calls legal-engine)
 * @see /lib/legal/storage.ts   — publishSnapshot (archive + upload to Storage)
 * @see /lib/legal/derive-config.ts — deriveLegalConfig
 * @see /lib/legal/validate-seller.ts — validateSeller
 * @see /lib/auth-server.ts     — requireAdminApi
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminApi } from '@/lib/auth-server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { isAllowedOrigin } from '@/lib/security/origin-match';
import { deriveLegalConfig, normalizeWebsiteDomain } from '@/lib/legal/derive-config';
import { validateSeller } from '@/lib/legal/validate-seller';
import { wrapHtml } from '@/lib/legal/wrap-html';
import { renderDocument } from '@/lib/legal/client';
import { publishSnapshot } from '@/lib/legal/storage';
import type { SellerShopConfig, SellerIntegrations } from '@/lib/legal/types';

const BASE = process.env.LEGAL_ENGINE_URL ?? 'https://legal.sellf.app';

export async function POST(request: NextRequest) {
  try {
    // 0) Rate limiting — 10 requests per 5 minutes (admin-only endpoint, heavy operation)
    const rateLimitOk = await checkRateLimit('legal_generate', 10, 5);
    if (!rateLimitOk) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
        },
        {
          status: 429,
          headers: {
            'Retry-After': '300', // 5 minutes
          },
        },
      );
    }

    // 1) Admin gate — throws 'Unauthorized' or 'Forbidden' on failure
    const supabase = await createClient();
    await requireAdminApi(supabase);

    // 2) Load shop_config singleton, integrations_config, and products (service-role)
    const adminClient = createAdminClient();

    const [shopConfigResult, integrationsResult, productsResult] = await Promise.all([
      adminClient.from('shop_config').select('*').maybeSingle(),
      adminClient.from('integrations_config').select('gtm_container_id, facebook_pixel_id, google_ads_conversion_id').maybeSingle(),
      adminClient
        .from('products')
        .select('product_type, billing_interval')
        .then((res: { data: Array<{ product_type: string; billing_interval: string | null }> | null; error: unknown }) => res),
    ]);

    if (shopConfigResult.error || !shopConfigResult.data) {
      console.error('[legal/generate] Failed to load shop_config:', shopConfigResult.error);
      return NextResponse.json({ ok: false, error: 'config_unavailable' }, { status: 500 });
    }

    if (productsResult.error) {
      console.error('[legal/generate] Failed to load products:', productsResult.error);
      return NextResponse.json({ ok: false, error: 'products_unavailable' }, { status: 502 });
    }

    const shopConfig = shopConfigResult.data as SellerShopConfig & { id: string };

    // Poland-only gate — legal documents are Polish-law only.
    // Enforce BEFORE deriving/rendering to avoid unnecessary work.
    if (shopConfig.country !== 'PL') {
      return NextResponse.json(
        { ok: false, error: 'not_polish_installation' },
        { status: 403 },
      );
    }

    const integrations: SellerIntegrations = integrationsResult.data ?? {
      gtm_container_id: null,
      facebook_pixel_id: null,
      google_ads_conversion_id: null,
    };
    const products: Array<{ product_type: string; billing_interval: string | null }> =
      productsResult.data ?? [];

    // Derive website domain from env — normalize to bare hostname (no protocol/port/path)
    // so legal-engine receives e.g. "shop.pl" not "https://shop.pl" or "http://localhost:3777"
    const websiteDomain = normalizeWebsiteDomain(
      process.env.MAIN_DOMAIN ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      '',
    );

    // 3) Derive legal config from shop data
    const { company, flags } = deriveLegalConfig({ shopConfig, products, integrations, websiteDomain });

    // 4) Validate seller completeness before calling legal-engine
    const seller = validateSeller(company);
    if (!seller.ok) {
      return NextResponse.json(
        { ok: false, error: 'missing_fields', missing: seller.missing },
        { status: 422 },
      );
    }

    // 5) Render both documents (fail fast on first error)
    const titles = { terms: 'Regulamin', privacy: 'Polityka prywatności' } as const;
    const rendered: Record<'terms' | 'privacy', string> = {} as Record<'terms' | 'privacy', string>;

    for (const type of ['terms', 'privacy'] as const) {
      const r = await renderDocument(BASE, { type, lang: 'pl', format: 'html', company, flags });
      if (!r.ok) {
        return NextResponse.json(
          { ok: false, error: 'render_failed', status: r.status, details: r.errors },
          { status: 502 },
        );
      }
      rendered[type] = wrapHtml(r.html, titles[type]);
    }

    // 6) Publish BOTH documents atomically — only set URLs after both succeed.
    //    publishSnapshot archives the existing doc before overwriting it.
    const shopId = shopConfig.id;
    let termsUrl: string;
    let privacyUrl: string;

    try {
      termsUrl = await publishSnapshot(adminClient as Parameters<typeof publishSnapshot>[0], shopId, 'terms', rendered.terms);
      privacyUrl = await publishSnapshot(adminClient as Parameters<typeof publishSnapshot>[0], shopId, 'privacy', rendered.privacy);
    } catch (err) {
      console.error('[legal/generate] Storage publish failed:', err);
      return NextResponse.json({ ok: false, error: 'storage_failed' }, { status: 502 });
    }

    // 7) Persist URLs to shop_config singleton (after both uploads succeed)
    const { error: updateError } = await adminClient
      .from('shop_config')
      .update({
        terms_of_service_url: termsUrl,
        privacy_policy_url: privacyUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('[legal/generate] Failed to update shop_config URLs:', updateError);
      // Docs are published but URLs not saved — log and still return success with URLs
      // so caller can manually set them if needed.
      return NextResponse.json({ ok: true, termsUrl, privacyUrl, warning: 'url_save_failed' });
    }

    return NextResponse.json({ ok: true, termsUrl, privacyUrl });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('[legal/generate] Unexpected error:', error);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}

/**
 * Handle OPTIONS request for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const siteUrl = process.env.SITE_URL;

  if (!siteUrl || !isAllowedOrigin(origin, [siteUrl])) {
    return new NextResponse(null, {
      status: 403,
      headers: { Vary: 'Origin' },
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': new URL(siteUrl).origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}
