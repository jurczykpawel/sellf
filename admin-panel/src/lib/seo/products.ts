/** Public product URLs and structured data. @see app/[locale]/p/[slug]/page.tsx */
import { defaultLocale, locales } from '@/lib/locales';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';
import type { Product } from '@/types';

type ProductVisibility = Pick<Product, 'is_active' | 'is_listed' | 'available_from' | 'available_until'>;

export function isIndexableProduct(product: ProductVisibility, now = new Date()): boolean {
  return product.is_active && product.is_listed &&
    (!product.available_from || new Date(product.available_from) <= now) &&
    (!product.available_until || new Date(product.available_until) > now);
}

export function getLocalizedUrl(path: string, locale: string): string {
  return `${getPublicBaseUrl()}${locale === defaultLocale ? '' : `/${locale}`}${path}`;
}

export function getProductAlternates(slug: string, locale: string) {
  const path = `/p/${encodeURIComponent(slug)}`;
  return {
    canonical: getLocalizedUrl(path, locale),
    languages: Object.fromEntries(locales.map((language) => [language, getLocalizedUrl(path, language)])),
  };
}

export function getProductJsonLd(product: Product, locale: string): string {
  const url = getProductAlternates(product.slug, locale).canonical;
  const subscription = product.product_type === 'subscription';
  const price = subscription ? (product.recurring_price ?? product.price) : getEffectiveUnitPrice(product);
  const interval = { day: 'D', week: 'W', month: 'M', year: 'Y' };
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    url,
    ...(product.image_url ? { image: product.image_url } : {}),
    ...(!product.allow_custom_price ? {
      offers: {
        '@type': 'Offer', url, price, priceCurrency: product.currency.toUpperCase(),
        availability: 'https://schema.org/InStock',
        ...(subscription && product.billing_interval ? {
          priceSpecification: {
            '@type': 'UnitPriceSpecification', price, priceCurrency: product.currency.toUpperCase(),
            billingDuration: `P${product.billing_interval_count ?? 1}${interval[product.billing_interval]}`,
          },
        } : {}),
      },
    } : {}),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
