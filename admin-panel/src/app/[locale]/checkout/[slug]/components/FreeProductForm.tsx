'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Product } from '@/types';
import { buildOtoRedirectUrl } from '@/lib/payment/oto-redirect';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import { validateEmailAction } from '@/lib/actions/validate-email';
import CaptchaWidget from '@/components/captcha/CaptchaWidget';
import { useCaptcha } from '@/hooks/useCaptcha';
import TermsCheckbox from '@/components/TermsCheckbox';
import { OAuthIconButtons, signInWithOAuth, type OAuthProvider } from '@/components/OAuthIconButtons';
import { createClient } from '@/lib/supabase/client';
import { useConfig } from '@/components/providers/config-provider';
import { useTracking } from '@/hooks/useTracking';
import DemoCheckoutNotice from '@/components/DemoCheckoutNotice';
import ProductShowcase from './ProductShowcase';

interface FreeProductFormProps {
  product: Product;
}

export default function FreeProductForm({ product }: FreeProductFormProps) {
  const t = useTranslations('productView');
  const tSecurity = useTranslations('security');
  const tCompliance = useTranslations('compliance');
  const locale = useLocale();
  const { user } = useAuth();
  const { oauthProviders } = useConfig();
  const router = useRouter();
  const searchParams = useSearchParams();
  const successUrl = searchParams.get('success_url');
  const { track } = useTracking();
  const trackingFired = useRef(false);
  
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const captcha = useCaptcha();
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info' | null; text: string }>({
    type: null,
    text: '',
  });

  // Track view_item event on mount
  useEffect(() => {
    if (trackingFired.current) return;
    trackingFired.current = true;

    track('view_item', {
      value: 0,
      currency: product.currency,
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: 0,
        quantity: 1,
      }],
    });
  }, [product, track]);

  const handleFreeAccess = async () => {
    if (user) {
      if (!termsAccepted) {
        setMessage({ type: 'error', text: tCompliance('pleaseAcceptTerms') });
        return;
      }
      // Logged in user - grant access directly
      try {
        setLoading(true);
        
        const response = await fetch(`/api/public/products/${product.slug}/grant-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const errorData = await response.json();
          toast.error(errorData.error || t('failedToRequestAccess'));
          return;
        }

        const data = await response.json();
        toast.success(data.message || t('accessGrantedSuccessfully'));

        // Track generate_lead event for free product
        await track('generate_lead', {
          value: 0,
          currency: product.currency,
          items: [{
            item_id: product.id,
            item_name: product.name,
            price: 0,
            quantity: 1,
          }],
          userEmail: user.email || undefined,
        });

        // Redirect to OTO checkout if an OTO offer is configured for this product
        if (data.otoInfo?.has_oto && data.otoInfo.oto_product_slug) {
          const { url: otoUrl } = buildOtoRedirectUrl({
            locale,
            otoProductSlug: data.otoInfo.oto_product_slug,
            customerEmail: user.email || undefined,
            couponCode: data.otoInfo.coupon_code,
          });
          router.push(otoUrl);
          return;
        }

        // No OTO — redirect to success page (no session_id needed for free products)
        const redirectPath = `/p/${product.slug}/payment-status${successUrl ? `?success_url=${encodeURIComponent(successUrl)}` : ''}`;
        router.push(redirectPath);
      } catch {
        toast.error(t('unexpectedError'));
      } finally {
        setLoading(false);
      }
    } else {
      // Not logged in - send magic link
      await handleMagicLinkSubmit();
    }
  };

  const handleMagicLinkSubmit = async () => {
    if (!email) {
      setMessage({ type: 'error', text: t('enterEmailAddress') });
      captcha.reset();
      return;
    }

    // Check if terms are accepted for non-logged in users
    if (!termsAccepted) {
      setMessage({ type: 'error', text: tCompliance('pleaseAcceptTerms') });
      captcha.reset();
      return;
    }

    // Check if captcha token is present for non-logged in users
    if (!captcha.token) {
      setMessage({ type: 'error', text: tCompliance('securityVerificationRequired') });
      return;
    }

    // Enhanced email validation with disposable domain checking
    try {
      const emailValidation = await validateEmailAction(email);
      if (!emailValidation.isValid) {
        setMessage({ type: 'error', text: emailValidation.error || t('invalidEmailDisposable') });
        captcha.reset();
        return;
      }
    } catch {
      setMessage({ type: 'error', text: t('validEmailRequired') });
      captcha.reset();
      return;
    }

    setLoading(true);
    setMessage({ type: 'info', text: t('sendingMagicLink') });
    
    try {
      const supabase = await createClient();
      
      const authRedirectPath = `/auth/product-access?product=${encodeURIComponent(product.slug)}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ''}`;
      const redirectUrl = `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(authRedirectPath)}`;
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          captchaToken: captcha.token || undefined,
        },
      });

      if (error) {
        setMessage({ type: 'error', text: error.message });

        // Reset captcha after ANY error (it was consumed in the failed request)
        captcha.reset();
        return;
      }

      // Track generate_lead event for magic link flow
      await track('generate_lead', {
        value: 0,
        currency: product.currency,
        items: [{
          item_id: product.id,
          item_name: product.name,
          price: 0,
          quantity: 1,
        }],
        userEmail: email,
      });

      setMessage({
        type: 'success',
        text: t('checkEmailForMagicLink')
      });
      
    } catch {
      setMessage({ type: 'error', text: t('unexpectedError') });
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: OAuthProvider) => {
    if (!termsAccepted) {
      setMessage({ type: 'error', text: tCompliance('pleaseAcceptTerms') });
      return;
    }
    const authRedirectPath = `/auth/product-access?product=${encodeURIComponent(product.slug)}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ''}`;
    // Store redirect path in a short-lived cookie instead of embedding it as a query param
    // in the OAuth redirectTo URL. Supabase validates redirectTo against the allowlist and
    // does not allow arbitrary query params — only the exact registered URL passes.
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `sf_oauth_redirect=${encodeURIComponent(authRedirectPath)}; path=/; max-age=300; SameSite=Lax${secure}`;
    await signInWithOAuth(provider, `${window.location.origin}/auth/callback`);
  };

  const renderProductInfo = () => (
    <ProductShowcase product={product} />
  );

  const renderForm = () => (
    <div className="w-1/2 pl-8">
      <div className="bg-sf-raised backdrop-blur-md rounded-2xl p-6 border border-sf-border">
        <h2 className="text-xl font-semibold text-sf-heading mb-4">
          {user ? t('getYourFreeProduct') : t('getInstantAccess')}
        </h2>
        
        {message.type && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-sf-success-soft border border-sf-success/20 text-sf-success' :
            message.type === 'error' ? 'bg-sf-danger-soft border border-sf-danger/20 text-sf-danger' :
            'bg-sf-accent-soft border border-sf-accent/20 text-sf-accent'
          }`}>
            {message.text}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleFreeAccess(); }} className="space-y-4">
          {!user && (
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-sf-body mb-2">
                {t('emailAddress')}
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 border border-sf-border rounded-lg bg-sf-input text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
                placeholder={t('enterEmailAddress')}
                required
                disabled={loading}
              />
            </div>
          )}

          {/* Terms and Conditions Checkbox - always shown */}
          <TermsCheckbox
            checked={termsAccepted}
            onChange={setTermsAccepted}
            termsUrl="/terms"
            privacyUrl="/privacy"
          />

          <button
            type="submit"
            disabled={
              loading ||
              captcha.isLoading ||
              !termsAccepted ||
              (!user && (!email || (process.env.NODE_ENV === 'production' && !captcha.token)))
            }
            className="w-full bg-sf-success hover:bg-sf-success/90 disabled:bg-sf-muted/30 disabled:cursor-not-allowed text-sf-inverse font-semibold py-3 px-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sf-success focus:ring-offset-2 active:scale-[0.98]"
          >
            {loading || captcha.isLoading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                {captcha.isLoading ? tSecurity('verifying') : t('processing')}
              </div>
            ) : (
              user ? t('getFreeAccess') : t('sendMagicLink')
            )}
          </button>

          {!user && oauthProviders.length > 0 && (
            <div>
              <div className="relative my-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-sf-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-sf-raised px-3 text-sf-muted">{tCompliance('orContinueWith')}</span>
                </div>
              </div>
              <div className="flex justify-center gap-3 mt-3">
                <OAuthIconButtons providers={oauthProviders} onSignIn={handleOAuthSignIn} disabled={loading} />
              </div>
            </div>
          )}

          {!user && (
            <>
              {/* Captcha — auto-detects Turnstile vs ALTCHA */}
              <div className="mt-3">
                <CaptchaWidget
                  onVerify={captcha.onVerify}
                  onError={captcha.onError}
                  onTimeout={captcha.onTimeout}
                  resetTrigger={captcha.resetTrigger}
                  compact={true}
                />
              </div>
              
              <p className="text-xs text-sf-muted mt-2 text-center">
                {t('magicLinkExplanation')}
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-sf-deep to-sf-raised">
      <div className="max-w-4xl mx-auto p-8 bg-sf-base border border-sf-border shadow-[var(--sf-shadow-accent)] backdrop-blur-md rounded-2xl">
        <DemoCheckoutNotice />
        <div className="flex">
          {renderProductInfo()}
          {renderForm()}
        </div>
      </div>
    </div>
  );
}
