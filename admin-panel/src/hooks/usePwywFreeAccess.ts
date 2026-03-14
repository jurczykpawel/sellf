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

interface UsePwywFreeAccessOptions {
  user: User | null;
  product: Product;
  onAccessGranted: () => void;
  onError: (msg: string) => void;
}

interface UsePwywFreeAccessReturn {
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

export function usePwywFreeAccess({
  user,
  product,
  onAccessGranted,
  onError,
}: UsePwywFreeAccessOptions): UsePwywFreeAccessReturn {
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
      const response = await fetch(`/api/public/products/${product.slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      await track('generate_lead', {
        value: 0,
        currency: product.currency,
        items: [{ item_id: product.id, item_name: product.name, price: 0, quantity: 1 }],
        userEmail: user.email || undefined,
      });
      onAccessGranted();
    } catch {
      onError(t('unexpectedError'));
    } finally {
      setPwywFreeLoading(false);
    }
  }, [user, product, track, onAccessGranted, onError, t]);

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
      const authRedirectPath = `/auth/product-access?product=${product.slug}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ''}`;
      const redirectUrl = `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(authRedirectPath)}`;

      const { error: authError } = await supabase.auth.signInWithOtp({
        email: pwywFreeEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          captchaToken: captcha.token || undefined,
        },
      });
      if (authError) {
        console.error('[usePwywFreeAccess] PWYW auth error:', authError.message);
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
  }, [pwywFreeEmail, pwywFreeTermsAccepted, captcha, product, searchParams, t, tCompliance, track]);

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
