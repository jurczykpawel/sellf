'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { validateEmailAction } from '@/lib/actions/validate-email';
import TurnstileWidget from '@/components/TurnstileWidget';
import TermsCheckbox from '@/components/TermsCheckbox';
import { createClient } from '@/lib/supabase/client';
import { useTracking } from '@/hooks/useTracking';
import DemoCheckoutNotice from '@/components/DemoCheckoutNotice';

interface FreeProductFormProps {
  product: Product;
}

export default function FreeProductForm({ product }: FreeProductFormProps) {
  const t = useTranslations('productView');
  const tSecurity = useTranslations('security');
  const tCompliance = useTranslations('compliance');
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const successUrl = searchParams.get('success_url');
  const { track } = useTracking();
  const trackingFired = useRef(false);
  
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetTrigger, setCaptchaResetTrigger] = useState(0);
  const [captchaLoading, setCaptchaLoading] = useState(false); // Will be set to true only when needed
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info' | null; text: string }>({
    type: null,
    text: '',
  });

  // Reset captcha function - simple and reliable
  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null); // Clear current token
    setCaptchaLoading(true); // Start loading immediately on reset (for invisible captcha)
    setCaptchaResetTrigger(prev => {
      const newValue = prev + 1;
      return newValue;
    });
  }, []);

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
      // Logged in user - grant access directly
      try {
        setLoading(true);
        
        const response = await fetch(`/api/public/products/${product.slug}/grant-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const errorData = await response.json();
          addToast(errorData.error || t('failedToRequestAccess'), 'error');
          return;
        }

        const data = await response.json();
        addToast(data.message || t('accessGrantedSuccessfully'), 'success');

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

        // Redirect to success page (no session_id needed for free products)
        const redirectPath = `/p/${product.slug}/payment-status${successUrl ? `?success_url=${encodeURIComponent(successUrl)}` : ''}`;
        router.push(redirectPath);
      } catch {
        addToast(t('unexpectedError'), 'error');
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
      resetCaptcha(); // Reset after validation error
      return;
    }

    // Check if terms are accepted for non-logged in users
    if (!termsAccepted) {
      setMessage({ type: 'error', text: tCompliance('pleaseAcceptTerms') });
      resetCaptcha(); // Reset after validation error
      return;
    }

    // Check if Turnstile token is present for non-logged in users
    if (!captchaToken) {
      setMessage({ type: 'error', text: tCompliance('securityVerificationRequired') });
      return; // Don't reset captcha if it's missing
    }

    // Enhanced email validation with disposable domain checking
    try {
      const emailValidation = await validateEmailAction(email);
      if (!emailValidation.isValid) {
        setMessage({ type: 'error', text: emailValidation.error || t('invalidEmailDisposable') });
        resetCaptcha(); // Reset after validation error
        return;
      }
    } catch {
      setMessage({ type: 'error', text: t('validEmailRequired') });
      resetCaptcha(); // Reset after validation error
      return;
    }

    setLoading(true);
    setMessage({ type: 'info', text: t('sendingMagicLink') });
    
    try {
      const supabase = await createClient();
      
      const authRedirectPath = `/auth/product-access?product=${product.slug}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ''}`;
      const redirectUrl = `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(authRedirectPath)}`;
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          captchaToken: captchaToken || undefined,
        },
      });

      if (error) {
        setMessage({ type: 'error', text: error.message });

        // Reset captcha after ANY error (it was consumed in the failed request)
        resetCaptcha();
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

  const renderProductInfo = () => (
    <div className="w-1/2 pr-8 border-r border-gf-border">
      <div className="flex items-center mb-6">
        <div className="text-5xl mr-6">{product.icon}</div>
        <div>
          <h1 className="text-2xl font-bold text-gf-heading">{product.name}</h1>
          <p className="text-gf-body">{product.description}</p>
        </div>
      </div>
      <div className="text-3xl font-bold text-gf-success">
        {t('free')}
      </div>
    </div>
  );

  const renderForm = () => (
    <div className="w-1/2 pl-8">
      <div className="bg-gf-raised backdrop-blur-md rounded-2xl p-6 border border-gf-border">
        <h2 className="text-xl font-semibold text-gf-heading mb-4">
          {user ? t('getYourFreeProduct') : t('getInstantAccess')}
        </h2>
        
        {message.type && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-gf-success-soft border border-gf-success/20 text-gf-success' :
            message.type === 'error' ? 'bg-gf-danger-soft border border-gf-danger/20 text-gf-danger' :
            'bg-gf-accent-soft border border-gf-accent/20 text-gf-accent'
          }`}>
            {message.text}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleFreeAccess(); }} className="space-y-4">
          {!user && (
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gf-body mb-2">
                {t('emailAddress')}
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 border border-gf-border rounded-lg bg-gf-input text-gf-heading placeholder-gf-muted focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent"
                placeholder={t('enterEmailAddress')}
                required
                disabled={loading}
              />
            </div>
          )}

          {!user && (
            <>
              {/* Terms and Conditions Checkbox */}
              <TermsCheckbox
                checked={termsAccepted}
                onChange={setTermsAccepted}
                termsUrl="/terms"
                privacyUrl="/privacy"
              />
            </>
          )}

          <button
            type="submit"
            disabled={
              loading || 
              captchaLoading || // Disable when captcha is loading
              (!user && (!email || !termsAccepted || (process.env.NODE_ENV === 'production' && !captchaToken)))
            }
            className="w-full bg-gf-success hover:bg-gf-success/90 disabled:bg-gf-muted/30 disabled:cursor-not-allowed text-gf-inverse font-semibold py-3 px-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gf-success focus:ring-offset-2 active:scale-[0.98]"
          >
            {loading || captchaLoading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                {captchaLoading ? tSecurity('verifying') : t('processing')}
              </div>
            ) : (
              user ? t('getFreeAccess') : t('sendMagicLink')
            )}
          </button>

          {!user && (
            <>
              {/* Cloudflare Turnstile - positioned after button, compact layout */}
              <div className="mt-3">
                <TurnstileWidget
                  onVerify={(token) => {
                    setCaptchaToken(token);
                    setCaptchaLoading(false); // ✅ FINAL: Captcha completed successfully
                  }}
                  onError={() => {
                    setCaptchaToken(null);
                    setCaptchaLoading(false); // ✅ FINAL: Reset loading on error
                  }}
                  onTimeout={() => {
                    setCaptchaLoading(false); // ✅ FINAL: Stop loading on timeout
                  }}
                  resetTrigger={captchaResetTrigger}
                  compact={true}
                />
              </div>
              
              <p className="text-xs text-gf-muted mt-2 text-center">
                {t('magicLinkExplanation')}
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-gf-deep to-gf-raised">
      <div className="max-w-4xl mx-auto p-8 bg-gf-base border border-gf-border shadow-[var(--gf-shadow-accent)] backdrop-blur-md rounded-2xl">
        <DemoCheckoutNotice />
        <div className="flex">
          {renderProductInfo()}
          {renderForm()}
        </div>
      </div>
    </div>
  );
}
