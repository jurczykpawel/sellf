/**
 * Product URL Builder
 *
 * Centralizes product URL generation for both platform and seller contexts.
 * Platform products: /p/{slug}
 * Seller products:   /s/{sellerSlug}/{slug}
 *
 * Usage:
 *   import { productUrl, checkoutUrl } from '@/lib/utils/product-urls';
 *   productUrl('my-product')                    // → /p/my-product
 *   productUrl('my-product', 'kowalski_digital') // → /s/kowalski_digital/my-product
 */

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

function assertSafeSlug(value: string, name: string): void {
  if (!SAFE_SLUG.test(value)) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
}

/** Product page URL */
export function productUrl(slug: string, sellerSlug?: string | null): string {
  assertSafeSlug(slug, 'slug');
  if (sellerSlug) assertSafeSlug(sellerSlug, 'sellerSlug');
  return sellerSlug ? `/s/${sellerSlug}/${slug}` : `/p/${slug}`;
}

/** Checkout page URL */
export function checkoutUrl(slug: string, sellerSlug?: string | null): string {
  assertSafeSlug(slug, 'slug');
  if (sellerSlug) assertSafeSlug(sellerSlug, 'sellerSlug');
  return sellerSlug ? `/s/${sellerSlug}/checkout/${slug}` : `/checkout/${slug}`;
}

/**
 * Payment status page URL.
 * Always uses /p/[slug]/payment-status (only route that exists).
 * Seller context preserved via ?seller= query param.
 */
export function paymentStatusUrl(slug: string, sellerSlug?: string | null): string {
  assertSafeSlug(slug, 'slug');
  if (sellerSlug) assertSafeSlug(sellerSlug, 'sellerSlug');
  const base = `/p/${slug}/payment-status`;
  return sellerSlug ? `${base}?seller=${encodeURIComponent(sellerSlug)}` : base;
}
