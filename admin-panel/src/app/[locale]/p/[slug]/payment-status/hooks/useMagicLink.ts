import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
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
      // Build redirect URL with appropriate parameter
      const paymentParam = sessionId
        ? `session_id=${sessionId}`
        : `payment_intent=${paymentIntentId}`;
      const redirectUrl = `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(`/p/${product.slug}/payment-status?${paymentParam}`)}`;
      const supabase = await createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: customerEmail,
        options: {
          emailRedirectTo: redirectUrl,
          shouldCreateUser: true,
          captchaToken: captchaToken || undefined,
        }
      });
      
      if (!authError) {
        setMagicLinkSent(true);
        setTimeout(() => setShowSpinnerForMinTime(false), 100);
      } else {
        console.error('Error sending magic link:', authError);
        // Set user-friendly error message based on error code
        if (authError.message.includes('email_address_invalid')) {
          setError(t('emailInvalidError'));
        } else if (authError.message.includes('captcha_failed')) {
          setError(t('captchaFailedError'));
        } else if (authError.message.includes('over_request_rate_limit')) {
          setError(t('rateLimitError'));
        } else {
          setError(t('genericError', { message: authError.message }));
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
