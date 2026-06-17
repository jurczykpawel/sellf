'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { Product } from '@/types';
import { useCaptcha } from '@/hooks/useCaptcha';
import { useTracking } from '@/hooks/useTracking';
import { validateEmailAction } from '@/lib/actions/validate-email';
import { createClient } from '@/lib/supabase/client';
import { buildFreeProductMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';

/**
 * Hook for the "get product for free" flow used by checkout pages.
 *
 * Drives two interchangeable free-access paths:
 *   1. PWYW with custom_price_min = 0 (no coupon needed).
 *   2. A full-discount (100%) coupon on an otherwise paid product.
 *
 * Both paths share the same UI and user flow: for logged-in users it calls
 * `grant-access` directly, for guests it sends a magic link whose callback
 * finalises the grant.
 */
interface UseFreeAccessOptions {
  user: User | null;
  product: Product;
  onAccessGranted: () => void;
  onError: (msg: string) => void;
  /** When set, this is a full-discount coupon flow. The code is attached to
   *  the grant-access request and to the magic-link redirect URL. */
  couponCode?: string | null;
  /** Product-defined custom checkout field values (e.g. license domain) collected
   *  from the logged-in form. Forwarded to grant-access so the issued license
   *  carries the same claims as a paid purchase. */
  customFieldValues?: Record<string, string>;
}

interface UseFreeAccessReturn {
  pwywFreeEmail: string;
  setPwywFreeEmail: (email: string) => void;
  pwywFreeTermsAccepted: boolean;
  setPwywFreeTermsAccepted: (accepted: boolean) => void;
  pwywFreeLoading: boolean;
  pwywFreeMessage: { type: 'info' | 'success' | 'error'; text: string } | null;
  captcha: ReturnType<typeof useCaptcha>;
  handlePwywFreeAccess: () => Promise<void>;
  handlePwywFreeMagicLink: () => Promise<void>;
}

export function useFreeAccess({
  user,
  product,
  onAccessGranted,
  onError,
  couponCode,
  customFieldValues,
}: UseFreeAccessOptions): UseFreeAccessReturn {
  const t = useTranslations('checkout');
  const tCompliance = useTranslations('compliance');
  const searchParams = useSearchParams();
  const { track } = useTracking();
  const captcha = useCaptcha();

  const [pwywFreeEmail, setPwywFreeEmail] = useState('');
  const [pwywFreeTermsAccepted, setPwywFreeTermsAccepted] = useState(false);
  const [pwywFreeLoading, setPwywFreeLoading] = useState(false);
  const [pwywFreeMessage, setPwywFreeMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  const handlePwywFreeAccess = useCallback(async () => {
    if (!user) return;
    setPwywFreeLoading(true);
    try {
      const hasCustomFields = !!customFieldValues && Object.keys(customFieldValues).length > 0;
      const response = await fetch(`/api/public/products/${product.slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(couponCode ? { couponCode } : {}),
          ...(hasCustomFields ? { customFieldValues } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'You already have access to this product' || data.alreadyHadAccess) {
          onAccessGranted();
          return;
        }
        onError(data.error || t('failedToGetAccess'));
        return;
      }
      // Analytics must never delay or block the success transition.
      void track('generate_lead', {
        value: 0,
        currency: product.currency,
        items: [{ item_id: product.id, item_name: product.name, price: 0, quantity: 1 }],
        userEmail: user.email || undefined,
      }).catch(() => {});
      onAccessGranted();
    } catch {
      onError(t('unexpectedError'));
    } finally {
      setPwywFreeLoading(false);
    }
  }, [user, product, couponCode, customFieldValues, track, onAccessGranted, onError, t]);

  const handlePwywFreeMagicLink = useCallback(async () => {
    if (!pwywFreeEmail) {
      setPwywFreeMessage({ type: 'error', text: t('enterEmail') });
      captcha.reset();
      return;
    }

    if (!pwywFreeTermsAccepted) {
      setPwywFreeMessage({ type: 'error', text: tCompliance('pleaseAcceptTerms') });
      captcha.reset();
      return;
    }

    if (!captcha.token) {
      setPwywFreeMessage({ type: 'error', text: tCompliance('securityVerificationRequired') });
      return;
    }

    try {
      const emailValidation = await validateEmailAction(pwywFreeEmail);
      if (!emailValidation.isValid) {
        setPwywFreeMessage({ type: 'error', text: emailValidation.error || t('invalidEmail') });
        captcha.reset();
        return;
      }
    } catch {
      setPwywFreeMessage({ type: 'error', text: t('invalidEmail') });
      captcha.reset();
      return;
    }

    setPwywFreeLoading(true);
    setPwywFreeMessage({ type: 'info', text: t('sendingMagicLink') });
    try {
      const supabase = await createClient();
      const successUrl = searchParams.get('success_url');
      const redirectUrl = buildFreeProductMagicLinkRedirect({
        origin: window.location.origin,
        productSlug: product.slug,
        couponCode,
        successUrl,
      });

      const { error: authError } = await supabase.auth.signInWithOtp({
        email: pwywFreeEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          captchaToken: captcha.token || undefined,
        },
      });
      if (authError) {
        console.error('[useFreeAccess] Magic link error:', authError.message);
        setPwywFreeMessage({ type: 'error', text: t('unexpectedError') });
        captcha.reset();
        return;
      }
      await track('generate_lead', {
        value: 0,
        currency: product.currency,
        items: [{ item_id: product.id, item_name: product.name, price: 0, quantity: 1 }],
        userEmail: pwywFreeEmail,
      });
      setPwywFreeMessage({ type: 'success', text: t('checkEmailForMagicLink') });
    } catch {
      setPwywFreeMessage({ type: 'error', text: t('unexpectedError') });
    } finally {
      setPwywFreeLoading(false);
    }
  }, [pwywFreeEmail, pwywFreeTermsAccepted, captcha, product, couponCode, searchParams, t, tCompliance, track]);

  return {
    pwywFreeEmail,
    setPwywFreeEmail,
    pwywFreeTermsAccepted,
    setPwywFreeTermsAccepted,
    pwywFreeLoading,
    pwywFreeMessage,
    captcha,
    handlePwywFreeAccess,
    handlePwywFreeMagicLink,
  };
}
