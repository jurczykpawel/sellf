'use client';

import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { productUrl, checkoutUrl, paymentStatusUrl } from '@/lib/utils/product-urls';

/**
 * Resolves seller context from auth state or URL params.
 *
 * Priority:
 *   1. useAuth().sellerSlug (logged-in seller admin)
 *   2. ?seller= search param (guest on seller checkout/payment-status)
 *
 * Usage:
 *   const { sellerSlug, buildProductUrl, buildCheckoutUrl } = useSellerContext();
 *   buildProductUrl('my-product') // → /s/kowalski_digital/my-product or /p/my-product
 */
export function useSellerContext() {
  const { sellerSlug: authSellerSlug } = useAuth();
  const searchParams = useSearchParams();
  const paramSellerSlug = searchParams.get('seller');

  const sellerSlug = authSellerSlug || paramSellerSlug || null;

  return {
    sellerSlug,
    buildProductUrl: (slug: string) => productUrl(slug, sellerSlug),
    buildCheckoutUrl: (slug: string) => checkoutUrl(slug, sellerSlug),
    buildPaymentStatusUrl: (slug: string) => paymentStatusUrl(slug, sellerSlug),
  };
}
