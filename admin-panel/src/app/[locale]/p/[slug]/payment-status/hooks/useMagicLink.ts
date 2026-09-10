import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { sendMagicLinkRequest } from '@/lib/auth/magic-link/client';
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
      const result = await sendMagicLinkRequest({
        email: customerEmail,
        captchaToken,
        flow: 'post_checkout',
        productSlug: product.slug,
      });

      if (result.ok) {
        setMagicLinkSent(true);
        setTimeout(() => setShowSpinnerForMinTime(false), 100);
      } else {
        // Set user-friendly error message based on error code
        if (result.code === 'invalid_email') {
          setError(t('emailInvalidError'));
        } else if (result.code === 'captcha_failed') {
          setError(t('captchaFailedError'));
        } else if (result.code === 'rate_limited') {
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
  }, [customerEmail, sessionId, paymentIntentId, product.slug, captchaToken, error, t]);

  // Auto-send magic link when conditions are met
  useEffect(() => {
    // Terms are always accepted in checkout before reaching this page
    const termsOk = true;
    const turnstileOk = captchaToken;
    const paymentId = sessionId || paymentIntentId;

    if (paymentStatus === 'magic_link_sent' &&
        customerEmail &&
        paymentId &&
        !magicLinkSent &&
        termsOk &&
        turnstileOk &&
        !sendingMagicLink &&
        !error) { // Don't auto-send if there's an error
      sendMagicLinkInternal();
    }
  }, [paymentStatus, customerEmail, sessionId, paymentIntentId, magicLinkSent, sendingMagicLink, captchaToken, sendMagicLinkInternal, error]);

  // Show spinner for minimum time - different logic for invisible vs interactive
  useEffect(() => {
    // Terms are always accepted in checkout before reaching this page
    const termsOk = true;
    const paymentId = sessionId || paymentIntentId;

    // For invisible captcha: show spinner early (when terms OK)
    // For interactive captcha: show spinner only when captcha token received
    const shouldTriggerSpinner = paymentStatus === 'magic_link_sent' &&
                                customerEmail &&
                                paymentId &&
                                termsOk &&
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
