/**
 * Seller Storefront Page
 *
 * Displays a seller's public shop using the same Storefront component as the main store.
 * Route: /s/{seller-slug} or /{locale}/s/{seller-slug}
 *
 * @see src/components/storefront/Storefront.tsx — shared storefront UI
 * @see src/lib/marketplace/seller-client.ts — seller lookup
 */

import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { cache } from 'react';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerBySlug, createSellerPublicClient } from '@/lib/marketplace/seller-client';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import type { Product } from '@/types';

// ISR — seller storefronts are public, cacheable
export const revalidate = 60;

interface PageProps {
  params: Promise<{ seller: string; locale: string }>;
}

// ===== DATA FETCHING =====

const getSellerData = cache(async (sellerSlug: string) => {
  const seller = await getSellerBySlug(sellerSlug);
  if (!seller) return null;

  const client = createSellerPublicClient(seller.schema_name);

  const [productsResult, shopConfigResult] = await Promise.all([
    client
      .from('products')
      .select('*')
      .eq('is_active', true)
      .eq('is_listed', true)
      .order('is_featured', { ascending: false })
      .order('price', { ascending: true }),
    client
      .from('shop_config')
      .select('*')
      .maybeSingle(),
  ]);

  return {
    seller,
    products: (productsResult.data as Product[]) || [],
    shopConfig: shopConfigResult.data,
  };
});

// ===== METADATA =====

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { seller: sellerSlug } = await params;
  const data = await getSellerData(sellerSlug);

  if (!data) {
    return { title: 'Seller Not Found' };
  }

  return {
    title: `${data.seller.display_name} — Shop`,
    description: `Browse products from ${data.seller.display_name}`,
  };
}

// ===== PAGE =====

export default async function SellerStorefrontPage({ params }: PageProps) {
  const access = await checkMarketplaceAccess();
  if (!access.accessible) {
    return notFound();
  }

  const { seller: sellerSlug } = await params;
  const data = await getSellerData(sellerSlug);

  if (!data) {
    return notFound();
  }

  const { seller, products, shopConfig } = data;

  // Use the same SmartLandingClient as the main store,
  // with productLinkPrefix pointing to seller routes
  return (
    <SmartLandingClient
      hasProducts={products.length > 0}
      products={products}
      shopConfig={{
        ...shopConfig,
        shop_name: seller.display_name,
      }}
      productLinkPrefix={`/s/${sellerSlug}`}
    />
  );
}
