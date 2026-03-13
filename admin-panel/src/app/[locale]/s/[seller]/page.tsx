/**
 * Seller Storefront Page
 *
 * Displays a seller's public shop with their products.
 * Route: /s/{seller-slug} or /{locale}/s/{seller-slug}
 *
 * @see src/lib/marketplace/seller-client.ts — seller lookup
 * @see src/lib/marketplace/feature-flag.ts — marketplace gate
 */

import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerBySlug, createSellerPublicClient } from '@/lib/marketplace/seller-client';
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
  const { data: products } = await client
    .from('products')
    .select('id, name, slug, description, icon, image_url, thumbnail_url, price, currency, is_active, is_listed, is_featured, allow_custom_price, custom_price_min')
    .eq('is_active', true)
    .eq('is_listed', true)
    .order('is_featured', { ascending: false })
    .order('price', { ascending: true });

  return {
    seller,
    products: (products as Product[]) || [],
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
  // Gate: marketplace must be enabled
  const access = checkMarketplaceAccess();
  if (!access.accessible) {
    return notFound();
  }

  const { seller: sellerSlug, locale } = await params;
  const data = await getSellerData(sellerSlug);

  if (!data) {
    return notFound();
  }

  const { seller, products } = data;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Seller Header */}
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900">{seller.display_name}</h1>
          <p className="text-gray-600 mt-2">{products.length} products</p>
        </div>
      </div>

      {/* Product Grid */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {products.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg">No products available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <Link
                key={product.id}
                href={`/${locale}/s/${sellerSlug}/${product.slug}`}
                className="block bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow p-6"
              >
                {product.icon && (
                  <div className="text-4xl mb-3">{product.icon}</div>
                )}
                {product.image_url && (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-48 object-cover rounded-md mb-4"
                  />
                )}
                <h2 className="text-xl font-semibold text-gray-900">{product.name}</h2>
                {product.description && (
                  <p className="text-gray-600 mt-2 line-clamp-2">{product.description}</p>
                )}
                <div className="mt-4 text-lg font-bold text-blue-600">
                  {product.price === 0
                    ? 'Free'
                    : product.allow_custom_price
                      ? `From ${new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency || 'USD' }).format(product.custom_price_min || 0)}`
                      : new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency || 'USD' }).format(product.price)
                  }
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
