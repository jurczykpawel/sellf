import { useEffect, useState, useCallback, useRef } from 'react';
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

  const requestInFlight = useRef(false);

  const tDemo = useTranslations('demo');
  const t = useTranslations('paymentStatus');

  const sendMagicLinkInternal = useCallback(async () => {
    // Need either sessionId (embedded checkout) or paymentIntentId (payment intent)
    const paymentId = sessionId || paymentIntentId;
    if (!customerEmail || !paymentId) return;

    // Don't send if we already have an error
    if (error) return;

    if (requestInFlight.current) return;
    requestInFlight.current = true;

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
        if (result.reason === 'demo_mode') {
          setError(tDemo('authBlocked'));
        } else if (result.reason === 'invalid_email') {
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
      requestInFlight.current = false;
      setSendingMagicLink(false);
    }
  }, [customerEmail, sessionId, paymentIntentId, product.slug, captchaToken, captchaReset, error, t, tDemo]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Only the awaited delivery result updates state.
      sendMagicLinkInternal();
    }
  }, [paymentStatus, customerEmail, sessionId, paymentIntentId, magicLinkSent, sendingMagicLink, captchaToken, sendMagicLinkInternal, error]);

  const paymentId = sessionId || paymentIntentId;
  const autoSending = paymentStatus === 'magic_link_sent' && !!customerEmail && !!paymentId &&
    !!captchaToken && !magicLinkSent && !error;
  const shouldTriggerSpinner = paymentStatus === 'magic_link_sent' && !!customerEmail && !!paymentId &&
    (!!captchaToken || !showInteractiveWarning) && !magicLinkSent;
  const spinnerKey = `${paymentId}:${customerEmail}`;
  const [spinnerRequest, setSpinnerRequest] = useState<string | null>(null);
  if (shouldTriggerSpinner && spinnerRequest !== spinnerKey) {
    setSpinnerRequest(spinnerKey);
    setShowSpinnerForMinTime(true);
  }
  useEffect(() => {
    if (!showSpinnerForMinTime) return;
    const timer = setTimeout(() => setShowSpinnerForMinTime(false), SPINNER_MIN_TIME);
    return () => clearTimeout(timer);
  }, [showSpinnerForMinTime, spinnerRequest]);

  const sendMagicLink = useCallback(() => {
    if (!customerEmail || !paymentId || error || requestInFlight.current) return Promise.resolve();
    setSendingMagicLink(true);
    return sendMagicLinkInternal();
  }, [customerEmail, paymentId, error, sendMagicLinkInternal]);

  return {
    sent: magicLinkSent,
    sending: sendingMagicLink || autoSending,
    showSpinnerForMinTime,
    sendMagicLink,
    error,
  };
}
