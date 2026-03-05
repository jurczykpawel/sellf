import { createPublicClient, createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateLicense, extractDomainFromUrl } from '@/lib/license/verify';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { cache } from 'react';
import ProductView from './components/ProductView';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Product page is per-user: access check, personalized content, preview mode.
// ISR would cache access state across users — force dynamic instead.
export const dynamic = 'force-dynamic';

// OPTIMIZED: Cached data fetcher - React cache() deduplicates requests in the same render cycle
// This eliminates duplicate queries between generateMetadata() and ProductPage()
// Explicit field list — avoids pulling future sensitive columns automatically.
// Must stay in sync with the Product interface in src/types/index.ts.
// IMPORTANT: content_config IS fetched here (needed for redirect_url + preview)
// but is sanitized via safeProduct before being sent to the client.
const PRODUCT_FIELDS = [
  'id', 'name', 'slug', 'description', 'long_description',
  'icon', 'image_url', 'thumbnail_url',
  'price', 'currency', 'vat_rate', 'price_includes_vat',
  'features', 'layout_template',
  'is_active', 'is_featured', 'is_listed',
  'omnibus_exempt',
  'sale_price', 'sale_price_until', 'sale_quantity_limit', 'sale_quantity_sold',
  'available_from', 'available_until', 'auto_grant_duration_days',
  'content_delivery_type', 'content_config',
  'success_redirect_url', 'pass_params_to_redirect',
  'is_refundable', 'refund_period_days',
  'enable_waitlist',
  'allow_custom_price', 'custom_price_min', 'show_price_presets', 'custom_price_presets',
  'created_at', 'updated_at', 'tenant_id',
].join(', ');

const getProduct = cache(async (slug: string) => {
  const supabase = createPublicClient();
  const { data: product, error } = await supabase
    .from('products')
    .select(PRODUCT_FIELDS)
    .eq('slug', slug)
    .single();

  return { product, error };
});

// Generate metadata for the page based on the product data
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { product } = await getProduct(slug); // DEDUPED

  if (!product) {
    return {
      title: 'Product Not Found',
    };
  }

  return {
    title: product.name,
    description: product.description,
  };
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
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
      .select(PRODUCT_FIELDS)
      .eq('slug', slug)
      .single();
    product = data;
    fetchError = error;
  } else {
    const { product: pub, error } = await getProduct(slug);
    product = pub;
    fetchError = error;
  }

  if (fetchError || !product) {
    return notFound();
  }

  // Check license server-side
  let licenseValid = false;
  try {
    const adminSupabase = createAdminClient();
    const { data: integrations } = await adminSupabase
      .from('integrations_config')
      .select('sellf_license')
      .eq('id', 1)
      .single();

    if (integrations?.sellf_license) {
      const domain = extractDomainFromUrl(process.env.NEXT_PUBLIC_APP_URL ?? '') ?? undefined;
      const result = validateLicense(integrations.sellf_license, domain);
      licenseValid = result.valid;
    }
  } catch {
    // License check failure is non-fatal — branding watermark stays visible
  }

  // Preview mode: server-side admin check — no client-side race conditions.
  // Only active when ?preview=1 AND the requester is a verified admin.
  // (previewMode already determined above, before product fetch)

  // SECURITY: Strip sensitive content_config before sending to client component.
  // The full content_config (with download_url, video URLs etc.) is in the DB row
  // from select('*'), but it must NOT leak in the RSC payload — unauthenticated
  // visitors could extract it from the page source / network tab.
  // Authenticated content delivery happens via /api/public/products/[slug]/content.
  const safeProduct = {
    ...product,
    content_config: product.content_delivery_type === 'redirect'
      ? { redirect_url: product.content_config?.redirect_url }  // redirect URL needed client-side
      : {},                                                       // content items served via auth API
  };

  return <ProductView product={safeProduct as typeof product} licenseValid={licenseValid} previewMode={previewMode} />;
}
