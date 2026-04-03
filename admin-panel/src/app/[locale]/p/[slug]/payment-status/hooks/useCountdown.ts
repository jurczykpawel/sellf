import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTDOWN_START } from '../utils/helpers';
import { PaymentStatus } from '../types';
import { productUrl } from '@/lib/utils/product-urls';

interface UseCountdownParams {
  paymentStatus: PaymentStatus;
  accessGranted: boolean;
  isUserAuthenticated: boolean | null;
  productSlug: string;
  redirectUrl?: string;
  /** When true, countdown runs but doesn't auto-redirect (used when OTO is shown) */
  disableAutoRedirect?: boolean;
  /** For guest purchases: only start countdown after magic link is sent */
  magicLinkSent?: boolean;
}

export function useCountdown({
  paymentStatus,
  accessGranted,
  isUserAuthenticated,
  productSlug,
  redirectUrl,
  disableAutoRedirect = false,
  magicLinkSent = false,
}: UseCountdownParams) {
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const router = useRouter();

  useEffect(() => {
    // Don't run countdown at all if auto-redirect is disabled
    if (disableAutoRedirect) {
      return;
    }

    // Determine if auto-redirect should happen:
    // 1. Authenticated user with completed payment
    // 2. Guest purchase (magic_link_sent) with redirect URL AND magic link already sent
    const isAuthenticatedSuccess = paymentStatus === 'completed' && accessGranted && isUserAuthenticated;
    const isGuestSuccessWithRedirect = paymentStatus === 'magic_link_sent' && redirectUrl && magicLinkSent;

    if (isAuthenticatedSuccess || isGuestSuccessWithRedirect) {
      const timer = setTimeout(() => {
        if (countdown > 1) {
          setCountdown(countdown - 1);
        } else {
          // Redirect to custom URL or back to product page
          if (redirectUrl) {
            window.location.href = redirectUrl;
          } else {
            router.push(productUrl(productSlug));
          }
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [countdown, router, productSlug, paymentStatus, accessGranted, isUserAuthenticated, redirectUrl, disableAutoRedirect, magicLinkSent]);

  return countdown;
}
