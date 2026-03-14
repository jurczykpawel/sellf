'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { Product } from '@/types';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';

interface UseCheckoutRedirectOptions {
  product: Product;
  bumpSelected: boolean;
  isFunnelTest: boolean;
  funnelTestOtoSlug: string | null;
}

interface UseCheckoutRedirectReturn {
  hasAccess: boolean;
  /** Mark that the user has been granted access (triggers countdown + redirect) */
  grantAccess: () => void;
  countdown: number;
  handleRedirectToProduct: () => void;
}

export function useCheckoutRedirect({
  product,
  bumpSelected,
  isFunnelTest,
  funnelTestOtoSlug,
}: UseCheckoutRedirectOptions): UseCheckoutRedirectReturn {
  const t = useTranslations('checkout');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [hasAccess, setHasAccess] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const grantAccess = useCallback(() => {
    setHasAccess(true);
  }, []);

  const handleRedirectToProduct = useCallback(() => {
    // Priority 1: ?success_url param override — validated to prevent open redirect
    const successUrl = searchParams.get('success_url');
    if (successUrl && isSafeRedirectUrl(successUrl)) {
      router.push(successUrl);
      return;
    }

    // Priority 2: product.success_redirect_url (admin-configured)
    // Must pass isSafeRedirectUrl — external HTTPS URLs are allowed only if same-origin
    if (product.success_redirect_url && isSafeRedirectUrl(product.success_redirect_url)) {
      router.push(product.success_redirect_url);
      return;
    }

    // Priority 3: OTO — funnel test mode simulates post-purchase OTO flow
    if (isFunnelTest && funnelTestOtoSlug) {
      router.push(`/checkout/${funnelTestOtoSlug}?funnel_test=1`);
      return;
    }

    // Priority 4: bump selected -> my-products
    if (bumpSelected) {
      router.push('/my-products');
      return;
    }

    // Priority 5: funnel test fallback
    if (isFunnelTest) {
      toast.info(t('funnelTest.endToast'));
      router.push('/dashboard/products');
      return;
    }

    // Priority 6: default — product page
    router.push(`/p/${product.slug}`);
  }, [product.slug, product.success_redirect_url, router, bumpSelected, searchParams, isFunnelTest, funnelTestOtoSlug, t]);

  // Countdown and auto-redirect after access granted
  useEffect(() => {
    if (hasAccess && countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else if (hasAccess && countdown === 0) {
      handleRedirectToProduct();
    }
  }, [hasAccess, countdown, handleRedirectToProduct]);

  return { hasAccess, grantAccess, countdown, handleRedirectToProduct };
}
