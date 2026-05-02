'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { Product } from '@/types';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import { productUrl } from '@/lib/utils/product-urls';

interface UseCheckoutRedirectOptions {
  product: Product;
  bumpSelected: boolean;
  isFunnelTest: boolean;
  funnelTestOtoSlug: string | null;
  /**
   * Returns the active "OTO lookup settled" Promise. A getter (not the
   * promise itself) so the handler always awaits the current in-flight
   * fetch — useOto mutates the underlying ref on each (productId,
   * isFunnelTest) cycle, and a stale plain reference would block forever.
   */
  getFunnelTestOtoReady?: () => Promise<void>;
  /**
   * Returns the latest OTO slug bypassing the React closure. Required so the
   * post-await read sees the value the fetch wrote, even when this hook's
   * memoized callback still closes over the prior render's null.
   */
  getFunnelTestOtoSlug?: () => string | null;
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
  getFunnelTestOtoReady,
  getFunnelTestOtoSlug,
}: UseCheckoutRedirectOptions): UseCheckoutRedirectReturn {
  const t = useTranslations('checkout');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [hasAccess, setHasAccess] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const grantAccess = useCallback(() => {
    setHasAccess(true);
  }, []);

  const handleRedirectToProduct = useCallback(async () => {
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

    // In funnel-test mode the OTO lookup is asynchronous; wait for it to
    // settle so priority 3 fires deterministically when an OTO is configured.
    // The promise resolves once fetch finishes (success, failure, or no OTO).
    if (isFunnelTest && getFunnelTestOtoReady) {
      await getFunnelTestOtoReady();
    }
    // Read the latest slug via the getter so we don't pick up the closure's
    // pre-await snapshot — useOto writes the ref the moment the fetch yields
    // a slug, before React schedules the next render.
    const otoSlug = getFunnelTestOtoSlug ? getFunnelTestOtoSlug() : funnelTestOtoSlug;

    // Priority 3: OTO — funnel test mode simulates post-purchase OTO flow
    if (isFunnelTest && otoSlug) {
      router.push(`/checkout/${otoSlug}?funnel_test=1`);
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
    router.push(productUrl(product.slug));
  }, [product.slug, product.success_redirect_url, router, bumpSelected, searchParams, isFunnelTest, funnelTestOtoSlug, getFunnelTestOtoReady, getFunnelTestOtoSlug, t]);

  // Countdown and auto-redirect after access granted
  useEffect(() => {
    if (hasAccess && countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else if (hasAccess && countdown === 0) {
      void handleRedirectToProduct();
    }
  }, [hasAccess, countdown, handleRedirectToProduct]);

  return { hasAccess, grantAccess, countdown, handleRedirectToProduct };
}
