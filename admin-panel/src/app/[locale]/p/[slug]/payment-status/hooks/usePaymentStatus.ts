import { useAuthCheck } from './useAuthCheck';
import { useCountdown } from './useCountdown';
import { useWindowDimensions } from './useWindowDimensions';
import { useMagicLink } from './useMagicLink';
import { useTurnstile } from './useTurnstile';
import { useTerms } from './useTerms';
import { PaymentStatus, Product } from '../types';

interface UsePaymentStatusParams {
  paymentStatus: PaymentStatus;
  customerEmail?: string;
  sessionId?: string;
  paymentIntentId?: string;
  product: Product;
  accessGranted: boolean;
  redirectUrl?: string;
  /** Disable auto-redirect countdown (when OTO is shown) */
  disableAutoRedirect?: boolean;
}

export function usePaymentStatus({
  paymentStatus,
  customerEmail,
  sessionId,
  paymentIntentId,
  product,
  accessGranted,
  redirectUrl,
  disableAutoRedirect = false,
}: UsePaymentStatusParams) {
  const terms = useTerms();
  const turnstile = useTurnstile();

  const auth = useAuthCheck({
    paymentStatus,
    accessGranted
  });

  const magicLink = useMagicLink({
    paymentStatus,
    customerEmail,
    sessionId,
    paymentIntentId,
    product,
    termsAccepted: terms.accepted,
    captchaToken: turnstile.token,
    captchaReset: turnstile.reset,
    showInteractiveWarning: turnstile.showInteractiveWarning,
  });

  const countdown = useCountdown({
    paymentStatus,
    accessGranted,
    isUserAuthenticated: auth.isAuthenticated,
    productSlug: product.slug,
    redirectUrl,
    disableAutoRedirect,
    magicLinkSent: magicLink.sent,
  });

  const windowDimensions = useWindowDimensions();

  return {
    auth,
    countdown,
    windowDimensions,
    terms,
    turnstile,
    magicLink,
  };
}
