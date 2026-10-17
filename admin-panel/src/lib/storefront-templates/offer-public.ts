/** Published-only offer route orchestration. @see offer-repository.ts */
import 'server-only';
import { cache } from 'react';
import { boundedPublicRead } from '@/lib/public-cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { PRODUCT_PUBLIC_COLUMNS_CSV } from '@/lib/product-columns';
import { checkPublicFeature } from '@/lib/license/public-snapshot';
import { getLocalizedUrl, isIndexableProduct } from '@/lib/seo/products';
import { readPublishedOffer } from '@/lib/storefront-templates/offer-repository';
import { loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import { resolveOffer } from '@/lib/storefront-templates/offer';
import { resolvePublicTheme } from '@/lib/storefront-templates/public-theme';
import type { Metadata } from 'next';
import type { Product } from '@/types';

export function offerMetadata(product: Pick<Product, 'slug' | 'name' | 'description' | 'is_active' | 'is_listed' | 'available_from' | 'available_until'>, locale: 'en' | 'pl'): Metadata {
  const path = `/offer/${encodeURIComponent(product.slug)}`;
  return { title: product.name, description: product.description, alternates: {
    canonical: getLocalizedUrl(path, locale), languages: { en: getLocalizedUrl(path, 'en'), pl: getLocalizedUrl(path, 'pl') },
  }, robots: { index: isIndexableProduct(product), follow: true } };
}

/** Only published presentation enters the shared cache; commerce stays authoritative. */
export const loadPublicOffer = cache(async (locale: 'en' | 'pl', slug: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return null;
  try {
    const client = createAdminClient();
    // Commercial metadata and section RPCs must describe the same current product.
    // This request-deduped read also observes newly scheduled boundaries immediately.
    const { data, error } = await client.from('products').select(PRODUCT_PUBLIC_COLUMNS_CSV).eq('slug', slug).maybeSingle();
    const product = error ? null : data as unknown as Product | null;
    if (!product?.is_active || !product.is_listed) return null;
    const published = await boundedPublicRead(['product-offer', product.id], [`product:${product.id}`, 'storefront-products'], async () => {
      const result = await readPublishedOffer(client, product.id);
      // Cache the explicit opt-out too, without accepting private draft/history fields.
      return result.success ? { config: result.data } : null;
    });
    if (!published?.config?.enabled) return null;
    const bound = await loadStorefrontBindings(client, { locale, heroProduct: product.id, closingProduct: product.id, target: 'offer' });
    if (!bound.success) return null;
    const theme = resolvePublicTheme(null, published.config.tokens, checkPublicFeature('theme-customization'));
    return { product, model: resolveOffer(published.config, locale, product.id, bound.data.hero), theme };
  } catch { return null; }
});
