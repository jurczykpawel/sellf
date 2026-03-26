/**
 * Seller Product Page
 *
 * Displays a specific product from a seller's shop.
 * Route: /s/{seller-slug}/{product-slug} or /{locale}/s/{seller-slug}/{product-slug}
 *
 * Follows the same pattern as /p/[slug]/page.tsx but uses the seller's schema.
 *
 * @see src/app/[locale]/p/[slug]/page.tsx — original product page
 * @see src/lib/marketplace/seller-client.ts — seller lookup
 */

import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { cache } from 'react';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerBySlug, createSellerPublicClient, createSellerAdminClient, normalizeSellerSlug } from '@/lib/marketplace/seller-client';
import { checkFeature } from '@/lib/license/resolve';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import ProductView from '@/app/[locale]/p/[slug]/components/ProductView';
import type { Product } from '@/types';

interface PageProps {
  params: Promise<{ seller: string; product: string; locale: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Per-user access checks → force dynamic
export const dynamic = 'force-dynamic';

import { PRODUCT_PAGE_FIELDS } from '@/lib/constants';

const getSellerProduct = cache(async (sellerSlug: string, productSlug: string) => {
  const seller = await getSellerBySlug(sellerSlug);
  if (!seller) return null;

  const client = createSellerPublicClient(seller.schema_name);
  const { data: product, error } = await client
    .from('products')
    .select(PRODUCT_PAGE_FIELDS)
    .eq('slug', productSlug)
    .single();

  if (error || !product) return null;
  return { seller, product: product as unknown as Product };
});

// ===== METADATA =====

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { seller: sellerSlug, product: productSlug } = await params;
  const data = await getSellerProduct(sellerSlug, productSlug);

  if (!data) {
    return { title: 'Product Not Found' };
  }

  return {
    title: `${data.product.name} — ${data.seller.display_name}`,
    description: data.product.description,
  };
}

// ===== PAGE =====

export default async function SellerProductPage({ params, searchParams }: PageProps) {
  const access = await checkMarketplaceAccess();
  if (!access.accessible) {
    return notFound();
  }

  const { seller: sellerSlug, product: productSlug } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};

  // Preview mode: allowed for platform admins AND the seller who owns this store
  let previewMode = false;
  if (resolvedSearch?.preview === '1') {
    try {
      const supabase = await createClient();
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (process.env.NODE_ENV !== 'production') {
          console.log('[Seller Preview] user:', user?.id, 'authErr:', authErr?.message, 'sellerSlug:', sellerSlug);
        }
      if (user) {
        // Platform admin check
        const { data: admin } = await supabase
          .from('admin_users')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (admin) {
          previewMode = true;
        } else {
          // Seller owner check: user owns this seller store
          const platform = createPlatformClient();
          const { data: sellerOwner } = await platform
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .eq('slug', normalizeSellerSlug(sellerSlug))
            .eq('status', 'active')
            .maybeSingle();
          if (sellerOwner) previewMode = true;
        }
      }
    } catch (err) {
      console.error('[Seller Preview] Auth check failed:', err);
    }
  }

  const seller = await getSellerBySlug(sellerSlug);
  if (!seller) return notFound();

  let product: Product | null = null;

  if (previewMode) {
    const adminClient = createSellerAdminClient(seller.schema_name);
    const { data } = await adminClient
      .from('products')
      .select(PRODUCT_PAGE_FIELDS)
      .eq('slug', productSlug)
      .single();
    product = data as unknown as Product | null;
  } else {
    const data = await getSellerProduct(sellerSlug, productSlug);
    product = data?.product ?? null;
  }

  if (!product) return notFound();

  // License check — per-seller (removes watermark for this seller)
  const sellerClient = createSellerAdminClient(seller.schema_name);
  const licenseValid = await checkFeature('watermark-removal', {
    dataClient: sellerClient,
    sellerSlug: seller.slug,
  });

  // Sanitize content_config (same security pattern as /p/[slug])
  const safeProduct = {
    ...product,
    content_config: previewMode
      ? product.content_config
      : product.content_delivery_type === 'redirect'
        ? { redirect_url: product.content_config?.redirect_url }
        : {},
  };

  return <ProductView product={safeProduct as typeof product} licenseValid={licenseValid} previewMode={previewMode} sellerSlug={seller.slug} />;
}
