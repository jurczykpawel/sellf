import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { submitMagicLink } from '@/lib/auth/magic-link/submit';
import { MagicLinkState, PaymentStatus, Product } from '../types';
import { SPINNER_MIN_TIME } from '../utils/helpers';

interface UseMagicLinkParams {
  paymentStatus: PaymentStatus;
  customerEmail?: string;
  sessionId?: string;
  paymentIntentId?: string;
  product: Product;
  termsAccepted: boolean;
  captchaToken: string | null;
  captchaReset: () => void;
  showInteractiveWarning: boolean;
}

export function useMagicLink({
  paymentStatus,
  customerEmail,
  sessionId,
  paymentIntentId,
  product,
  termsAccepted,
  captchaToken,
  captchaReset,
  showInteractiveWarning,
}: UseMagicLinkParams): MagicLinkState & { sendMagicLink: () => Promise<void>; error: string | null } {
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [showSpinnerForMinTime, setShowSpinnerForMinTime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const t = useTranslations('paymentStatus');
  
  const sendMagicLinkInternal = useCallback(async () => {
    // Need either sessionId (embedded checkout) or paymentIntentId (payment intent)
    const paymentId = sessionId || paymentIntentId;
    if (!customerEmail || !paymentId) return;

    // Don't send if we already have an error
    if (error) return;

    setSendingMagicLink(true);
    setError(null); // Clear previous errors

    try {
      const result = await submitMagicLink({
        email: customerEmail,
        captcha: { token: captchaToken, reset: captchaReset },
        flow: 'post_checkout',
        productSlug: product.slug,
      });

      if (result.ok) {
        setMagicLinkSent(true);
        setTimeout(() => setShowSpinnerForMinTime(false), 100);
      } else {
        // Set user-friendly error message based on error code
        if (result.reason === 'invalid_email') {
          setError(t('emailInvalidError'));
        } else if (result.reason === 'captcha_failed' || result.reason === 'captcha_missing') {
          setError(t('captchaFailedError'));
        } else if (result.reason === 'rate_limited') {
          setError(t('rateLimitError'));
        } else {
          setError(t('unexpectedError'));
        }
      }
    } catch (err) {
      console.error('Exception sending magic link:', err);
      setError(t('unexpectedError'));
    } finally {
      setSendingMagicLink(false);
    }
  }, [customerEmail, sessionId, paymentIntentId, product.slug, captchaToken, captchaReset, error, t]);

  // Auto-send magic link when conditions are met. Terms are always accepted
  // in checkout before reaching this page, so no terms check is needed here.
  useEffect(() => {
    const paymentId = sessionId || paymentIntentId;

    if (paymentStatus === 'magic_link_sent' &&
        customerEmail &&
        paymentId &&
        !magicLinkSent &&
        captchaToken &&
        !sendingMagicLink &&
        !error) { // Don't auto-send if there's an error
      sendMagicLinkInternal();
    }
  }, [paymentStatus, customerEmail, sessionId, paymentIntentId, magicLinkSent, sendingMagicLink, captchaToken, sendMagicLinkInternal, error]);

  // Show spinner for minimum time - different logic for invisible vs interactive
  useEffect(() => {
    const paymentId = sessionId || paymentIntentId;

    // For invisible captcha: show spinner early (when terms OK)
    // For interactive captcha: show spinner only when captcha token received
    const shouldTriggerSpinner = paymentStatus === 'magic_link_sent' &&
                                customerEmail &&
                                paymentId &&
                                (captchaToken || !showInteractiveWarning); // Show early for invisible, late for interactive

    if (shouldTriggerSpinner && !showSpinnerForMinTime && !magicLinkSent) {
      setShowSpinnerForMinTime(true);

      const timer = setTimeout(() => {
        setShowSpinnerForMinTime(false);
      }, SPINNER_MIN_TIME);

      return () => clearTimeout(timer);
    }
  }, [paymentStatus, customerEmail, sessionId, paymentIntentId, magicLinkSent, showSpinnerForMinTime, captchaToken, showInteractiveWarning]);

  return {
    sent: magicLinkSent,
    sending: sendingMagicLink,
    showSpinnerForMinTime,
    sendMagicLink: sendMagicLinkInternal,
    error,
  };
}
