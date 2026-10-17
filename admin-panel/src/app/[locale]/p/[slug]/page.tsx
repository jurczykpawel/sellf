import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { boundedPublicRead, productCacheBoundary } from '@/lib/public-cache';
import { createPublicClient, createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPublicFeature } from '@/lib/license/public-snapshot';
import { decideProductAccessOutcome } from '@/lib/payment/product-access-decision';
import { getShopConfig } from '@/lib/actions/shop-config';
import { findIssuedLicense, toIssuedLicenseResponse } from '@/lib/license-keys/lookup';
import { firstRelated } from '@/lib/supabase/relations';
import { PRODUCT_PUBLIC_COLUMNS_CSV } from '@/lib/product-columns';
import { getProductAlternates, getProductJsonLd, isIndexableProduct } from '@/lib/seo/products';
import { loadProductContentConfig } from '@/lib/services/product-content-config';
import ProductPurchasePage from '@/components/ProductPurchasePage';
import type { Metadata } from 'next';
import type { Product } from '@/types';
import type { ResolvedUserAccess } from '@/lib/payment/product-access-decision';
import type { SecureProductResponse } from '@/app/[locale]/p/[slug]/components/ProductAccessView';
import ProductView from './components/ProductView';

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Product page is per-user: access check, personalized content, preview mode.
// ISR would cache access state across users — force dynamic instead.
export const dynamic = 'force-dynamic';

// OPTIMIZED: Cached data fetcher - React cache() deduplicates requests in the same render cycle
// This eliminates duplicate queries between generateMetadata() and ProductPage()
// Explicit field list — avoids pulling future sensitive columns automatically.
// content_config is not part of it: it is loaded with the service role only
// for admin preview or once the visitor's access is confirmed.
const getProduct = cache(async (slug: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return { product: null, error: 'Product unavailable' };
  const product = await boundedPublicRead(['product-by-slug', slug], ['product-by-slug', `product:${slug}`, 'storefront-products'], async () => {
    const { data, error } = await createPublicClient().from('products').select(PRODUCT_PUBLIC_COLUMNS_CSV).eq('slug', slug).single();
    return error ? null : data as unknown as Product | null;
  }, { boundary: productCacheBoundary });
  return { product, error: product ? null : 'Product unavailable' };
});

// Generate metadata for the page based on the product data
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;
  const { product } = await getProduct(slug); // DEDUPED

  if (!product) {
    return {
      title: 'Product Not Found',
    };
  }

  return {
    title: product.name,
    description: product.description,
    alternates: getProductAlternates(slug, locale),
    robots: { index: isIndexableProduct(product), follow: true },
  };
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { slug, locale } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};

  // Determine preview mode early — needed before product fetch for inactive products.
  // Admin preview can see inactive products that the public view hides (RLS).
  let previewMode = false;
  if (resolvedSearch?.preview === '1') {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: admin } = await supabase
          .from('admin_users')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (admin) previewMode = true;
      }
    } catch {
      // Auth failure — preview mode stays false, normal flow applies
    }
  }

  // For admin preview, use the service-role client to bypass RLS and see inactive products.
  // For regular users, use the public (anon) client which respects visibility rules.
  let product = null;
  let fetchError = null;

  if (previewMode) {
    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from('products')
      .select(`${PRODUCT_PUBLIC_COLUMNS_CSV}, content_config`)
      .eq('slug', slug)
      .single();
    product = data as Product | null;
    fetchError = error;
  } else {
    const { product: pub, error } = await getProduct(slug);
    product = pub;
    fetchError = error;
  }

  if (fetchError || !product) {
    return notFound();
  }

  // Resolve license + auth in parallel — independent server-side checks.
  // Auth is treated as guest on any failure so a transient Supabase blip
  // doesn't take the public product page down with it.
  const [licenseValid, authResult] = await Promise.all([
    checkPublicFeature('watermark-removal'),
    (async () => {
      try {
        const c = await createClient();
        const { data: { user } } = await c.auth.getUser();
        return { client: c, user };
      } catch {
        return null;
      }
    })(),
  ]);

  let resolvedUser: { id: string } | null = null;
  let resolvedAccess: ResolvedUserAccess | null = null;
  if (authResult?.user) {
    resolvedUser = { id: authResult.user.id };
    // Pick the most recent access row: a single buyer can legitimately have
    // multiple records (re-purchase after expiry, admin re-grant after refund,
    // etc.). `.maybeSingle()` would error out on duplicates and lock the buyer
    // out of content they paid for — order by granted_at desc and limit(1).
    const { data: accessRows } = await authResult.client
      .from('user_product_access')
      .select('access_expires_at, access_duration_days, access_granted_at')
      .eq('user_id', authResult.user.id)
      .eq('product_id', product.id)
      .order('access_granted_at', { ascending: false })
      .limit(1);
    const accessRow = accessRows?.[0];
    if (accessRow) {
      resolvedAccess = {
        access_expires_at: accessRow.access_expires_at,
        access_duration_days: accessRow.access_duration_days,
        granted_at: accessRow.access_granted_at,
      };
    }
  }

  const outcome = decideProductAccessOutcome({
    user: resolvedUser,
    product: {
      id: product.id,
      is_active: product.is_active,
      available_from: product.available_from,
      available_until: product.available_until,
    },
    userAccess: resolvedAccess,
    now: new Date(),
    previewMode,
  });

  if (outcome.kind === 'redirect-checkout' && isIndexableProduct(product) &&
    !['email', 'coupon', 'oto'].some((key) => resolvedSearch[key])) {
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: getProductJsonLd(product, locale) }} />
        <ProductPurchasePage product={product} />
      </>
    );
  }

  if (outcome.kind === 'redirect-checkout') {
    // Preserve OTO/coupon query params so the checkout has the same context.
    const carry = ['email', 'coupon', 'oto']
      .map((k) => {
        const v = resolvedSearch?.[k];
        return typeof v === 'string' && v.length > 0 ? `${k}=${encodeURIComponent(v)}` : null;
      })
      .filter(Boolean)
      .join('&');
    redirect(`/checkout/${product.slug}${carry ? `?${carry}` : ''}`);
  }

  const existingLicense =
    !previewMode &&
    authResult?.user &&
    (outcome.kind === 'render-content' || outcome.kind === 'render-expired')
      ? toIssuedLicenseResponse(await findIssuedLicense(createAdminClient(), product.id, authResult.user))
      : null;

  // Prefetch the secure content payload server-side for authenticated buyers
  // — eliminates the "Loading secure content…" spinner inside ProductAccessView.
  // getShopConfig() is deduped per-render via React cache() (layout calls it).
  // Delivered content is loaded only for a visitor whose access is confirmed.
  const buyerContentConfig =
    outcome.kind === 'render-content' && !previewMode && resolvedAccess
      ? (await loadProductContentConfig(createAdminClient(), product.id)) ?? {}
      : null;

  let initialSecureData: SecureProductResponse | undefined;
  if (buyerContentConfig && resolvedAccess) {
    const shopConfig = await getShopConfig();
    const expiresAtIso = resolvedAccess.access_expires_at ?? null;
    const expiresAt = expiresAtIso ? new Date(expiresAtIso) : null;
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    // For bundles, resolve component products so the access view can link to each
    // owned component. Empty for non-bundles. Uses the FK-hinted relationship name
    // (bundle_items references products twice). Mirrors the content API's logic.
    let bundleComponents: SecureProductResponse['bundleComponents'] = [];
    if (product.is_bundle) {
      const { data: items, error: bundleError } = await createAdminClient()
        .from('bundle_items')
        .select('display_order, component:products!bundle_items_component_product_id_fkey(name,icon,slug)')
        .eq('bundle_product_id', product.id)
        .order('display_order');
      if (bundleError) {
        console.error('[ProductPage] Failed to load bundle components:', bundleError);
      } else {
        bundleComponents = (items ?? [])
          .map((i) => firstRelated<{ name: string; icon: string; slug: string }>(i.component))
          .filter((c): c is { name: string; icon: string; slug: string } => c != null);
      }
    }

    initialSecureData = {
      product: { ...product, content_config: buyerContentConfig },
      branding: { shop_name: shopConfig?.shop_name ?? null },
      license: existingLicense,
      bundleComponents,
      userAccess: {
        access_expires_at: expiresAtIso,
        access_duration_days: resolvedAccess.access_duration_days ?? null,
        access_granted_at: resolvedAccess.granted_at,
        is_expired: !!(expiresAt && expiresAt < now),
        is_expiring_soon: expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / msPerDay) <= 7 : false,
        days_until_expiration: expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / msPerDay) : null,
      },
    };
  }

  // Preview mode: server-side admin check — no client-side race conditions.
  // Only active when ?preview=1 AND the requester is a verified admin.
  // (previewMode already determined above, before product fetch)

  // The product prop carries content_config only where the visitor may see it:
  // admin preview gets the full config, a buyer of a redirect product gets the
  // redirect URL (ProductView navigates there client-side). Content items reach
  // buyers via initialSecureData or /api/public/products/[slug]/content.
  const safeProduct = {
    ...product,
    content_config: previewMode
      ? product.content_config
      : buyerContentConfig && product.content_delivery_type === 'redirect'
        ? { redirect_url: buyerContentConfig.redirect_url }
        : {},
  };

  return (
    <ProductView
      product={safeProduct as typeof product}
      licenseValid={licenseValid}
      previewMode={previewMode}
      outcome={outcome}
      initialSecureData={initialSecureData}
      existingLicense={existingLicense}
    />
  );
}
