'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Product } from '@/types';
import { buildOtoRedirectUrl } from '@/lib/payment/oto-redirect';
import { paymentStatusUrl } from '@/lib/utils/product-urls';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import { validateEmailAction } from '@/lib/actions/validate-email';
import CaptchaWidget from '@/components/captcha/CaptchaWidget';
import { useCaptcha } from '@/hooks/useCaptcha';
import TermsCheckbox from '@/components/TermsCheckbox';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import {
  validateCustomFieldValues,
  type CustomFieldDefinition,
  type CustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';
import { OAuthIconButtons, signInWithOAuth, type OAuthProvider } from '@/components/OAuthIconButtons';
import { createClient } from '@/lib/supabase/client';
import { buildFreeProductMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { useConfig } from '@/components/providers/config-provider';
import { useTracking } from '@/hooks/useTracking';
import { useOto } from '@/hooks/useOto';
import { useCheckoutRedirect } from '@/hooks/useCheckoutRedirect';
import DemoCheckoutNotice from '@/components/DemoCheckoutNotice';
import { shouldShowTosCheckbox } from '@/lib/checkout/tos-display';
import ProductShowcase from './ProductShowcase';
import type { BundleComponentSummary } from './BundleContentsPreview';
import FunnelTestBanner from './FunnelTestBanner';
import AccessGrantedCard from './AccessGrantedCard';

/** Stable no-op: free checkout never enters URL-coupon OTO mode, so useOto's
 *  coupon-ready callback is never invoked here. */
const noop = () => {};

interface FreeProductFormProps {
  product: Product;
  collectTermsOfService: boolean;
  bundleComponents?: BundleComponentSummary[];
}

export default function FreeProductForm({ product, collectTermsOfService, bundleComponents }: FreeProductFormProps) {
  const t = useTranslations('productView');
  const tCheckout = useTranslations('checkout');
  const tSecurity = useTranslations('security');
  const tCompliance = useTranslations('compliance');
  const locale = useLocale();
  const { user, isAdmin } = useAuth();
  const { oauthProviders } = useConfig();
  const router = useRouter();
  const searchParams = useSearchParams();
  const successUrl = searchParams.get('success_url');
  const { track } = useTracking();
  const trackingFired = useRef(false);

  // Funnel test mode: admin-only preview of the free → OTO funnel. Reuses the
  // same OTO lookup + redirect-priority logic as the paid checkout, so no real
  // access is granted — clicking the simulation button just walks the funnel.
  const isFunnelTest = searchParams.get('funnel_test') === '1' && isAdmin;
  const oto = useOto({
    urlCoupon: null,
    urlEmail: null,
    otoParam: null,
    productId: product.id,
    isFunnelTest,
    onCouponReady: noop,
  });
  const { hasAccess, grantAccess, countdown, handleRedirectToProduct } = useCheckoutRedirect({
    product,
    bumpSelected: false,
    isFunnelTest,
    funnelTestOtoSlug: oto.funnelTestOtoSlug,
    getFunnelTestOtoReady: oto.getFunnelTestOtoReady,
    getFunnelTestOtoSlug: oto.getFunnelTestOtoSlug,
  });
  
  const showTos = shouldShowTosCheckbox(collectTermsOfService, !user);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const captcha = useCaptcha();
  const customFieldDefs = useMemo<CustomFieldDefinition[]>(
    () => (Array.isArray(product.custom_checkout_fields) ? product.custom_checkout_fields : []),
    [product.custom_checkout_fields],
  );
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValues>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
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
      // Logged in user - grant access directly (ToS accepted at registration)
      const hasCustomFields = customFieldDefs.length > 0;
      if (hasCustomFields) {
        // Reuse the canonical validator (same rules as the server + paid flow).
        const validation = validateCustomFieldValues(customFieldDefs, customFieldValues, { requireAll: true });
        if (!validation.ok) {
          setCustomFieldErrors(validation.errors);
          return;
        }
        setCustomFieldErrors({});
      }
      try {
        setLoading(true);

        const response = await fetch(`/api/public/products/${product.slug}/grant-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hasCustomFields ? { customFieldValues } : {}),
        });

        if (!response.ok) {
          const errorData = await response.json();
          toast.error(errorData.error || t('failedToRequestAccess'));
          return;
        }

        const data = await response.json();
        toast.success(data.message || t('accessGrantedSuccessfully'));

        // Track generate_lead event for free product
        // Analytics must never delay or block access to the purchased content.
        void track('generate_lead', {
          value: 0,
          currency: product.currency,
          items: [{
            item_id: product.id,
            item_name: product.name,
            price: 0,
            quantity: 1,
          }],
          userEmail: user.email || undefined,
        }).catch(() => {});

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
        const statusBase = paymentStatusUrl(product.slug);
        const sep = statusBase.includes('?') ? '&' : '?';
        const redirectPath = successUrl ? `${statusBase}${sep}success_url=${encodeURIComponent(successUrl)}` : statusBase;
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
    if (showTos && !termsAccepted) {
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

      const redirectUrl = buildFreeProductMagicLinkRedirect({
        origin: window.location.origin,
        productSlug: product.slug,
        successUrl,
      });

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          captchaToken: captcha.token || undefined,
        },
      });

      if (error) {
        console.error('[FreeProductForm] Auth error:', error.message);
        setMessage({ type: 'error', text: t('unexpectedError') });

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
    if (showTos && !termsAccepted) {
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
    <ProductShowcase product={product} bundleComponents={bundleComponents} />
  );

  // Admin-only funnel preview: banner + simulation button → walks the free → OTO
  // funnel via the shared redirect hook, without granting real access.
  const renderFunnelTestPanel = () => (
    <div className="w-full lg:w-1/2 lg:pl-8">
      <FunnelTestBanner />
      <div className="bg-sf-raised backdrop-blur-md rounded-2xl p-6 border border-sf-border">
        {hasAccess ? (
          <AccessGrantedCard countdown={countdown} onGoToProduct={handleRedirectToProduct} />
        ) : (
          <button
            type="button"
            onClick={grantAccess}
            className="w-full py-4 px-6 bg-sf-warning hover:bg-sf-warning/90 text-sf-inverse font-bold rounded-xl transition-all active:scale-[0.98] text-lg"
          >
            {tCheckout('funnelTest.completeButtonFree')}
          </button>
        )}
      </div>
    </div>
  );

  const renderForm = () => (
    <div className="w-full lg:w-1/2 lg:pl-8">
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

          {/* Product-defined custom checkout fields (e.g. message, license domain).
              For logged-in users the values are validated and forwarded to the
              grant-access endpoint so a free/coupon grant issues the same license
              claims as a paid purchase. (Guest magic-link grants can't carry these
              across the round-trip yet — see grant-access route.) */}
          {customFieldDefs.length > 0 && (
            <CustomCheckoutFieldsForm
              fields={customFieldDefs}
              values={customFieldValues}
              onChange={(next) => {
                setCustomFieldValues(next);
                if (Object.keys(customFieldErrors).length > 0) setCustomFieldErrors({});
              }}
              errors={customFieldErrors}
              disabled={loading}
            />
          )}

          {/* Terms checkbox — only for guests when collect_terms_of_service is ON */}
          {showTos && (
            <TermsCheckbox
              checked={termsAccepted}
              onChange={setTermsAccepted}
              termsUrl="/terms"
              privacyUrl="/privacy"
            />
          )}

          <button
            type="submit"
            disabled={
              loading ||
              captcha.isLoading ||
              (showTos && !termsAccepted) ||
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
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-sf-deep to-sf-raised p-4 lg:p-8">
      <div className="w-full max-w-4xl mx-auto p-6 lg:p-8 bg-sf-base border border-sf-border shadow-[var(--sf-shadow-accent)] backdrop-blur-md rounded-2xl">
        <DemoCheckoutNotice />
        <div className="flex flex-col lg:flex-row">
          {renderProductInfo()}
          {isFunnelTest ? renderFunnelTestPanel() : renderForm()}
        </div>
      </div>
    </div>
  );
}
