/**
 * Product URL Builder
 *
 * Centralizes product URL generation.
 * Product pages: /p/{slug}
 * Checkout:      /checkout/{slug}
 * Payment status: /p/{slug}/payment-status
 *
 * Usage:
 *   import { productUrl, checkoutUrl } from '@/lib/utils/product-urls';
 *   productUrl('my-product')     // → /p/my-product
 *   checkoutUrl('my-product')    // → /checkout/my-product
 */

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

function assertSafeSlug(value: string, name: string): void {
  if (!SAFE_SLUG.test(value)) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
}

/** Product page URL */
export function productUrl(slug: string): string {
  assertSafeSlug(slug, 'slug');
  return `/p/${slug}`;
}

/** Checkout page URL */
export function checkoutUrl(slug: string): string {
  assertSafeSlug(slug, 'slug');
  return `/checkout/${slug}`;
}

/** Payment status page URL */
export function paymentStatusUrl(slug: string): string {
  assertSafeSlug(slug, 'slug');
  return `/p/${slug}/payment-status`;
}
