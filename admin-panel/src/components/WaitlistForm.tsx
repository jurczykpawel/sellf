'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import { validateEmailAction } from '@/lib/actions/validate-email';
import TurnstileWidget from '@/components/TurnstileWidget';
import TermsCheckbox from '@/components/TermsCheckbox';

interface WaitlistFormProps {
  product: Product;
  unavailableReason: 'not_started' | 'expired' | 'inactive';
}

export default function WaitlistForm({ product, unavailableReason }: WaitlistFormProps) {
  const t = useTranslations('waitlist');
  const tSecurity = useTranslations('security');
  const tCompliance = useTranslations('compliance');

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetTrigger, setCaptchaResetTrigger] = useState(0);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info' | null; text: string }>({
    type: null,
    text: '',
  });

  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaLoading(true);
    setCaptchaResetTrigger(prev => prev + 1);
  }, []);

  const getUnavailableMessage = () => {
    switch (unavailableReason) {
      case 'not_started':
        return t('productNotYetAvailable');
      case 'expired':
        return t('productNoLongerAvailable');
      case 'inactive':
      default:
        return t('productCurrentlyUnavailable');
    }
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setMessage({ type: 'error', text: t('pleaseEnterEmail') });
      resetCaptcha();
      return;
    }

    if (!termsAccepted) {
      setMessage({ type: 'error', text: tCompliance('pleaseAcceptTerms') });
      resetCaptcha();
      return;
    }

    if (!captchaToken && process.env.NODE_ENV === 'production') {
      setMessage({ type: 'error', text: tCompliance('securityVerificationRequired') });
      return;
    }

    // Validate email
    try {
      const emailValidation = await validateEmailAction(email);
      if (!emailValidation.isValid) {
        setMessage({ type: 'error', text: emailValidation.error || t('invalidEmail') });
        resetCaptcha();
        return;
      }
    } catch {
      setMessage({ type: 'error', text: t('invalidEmail') });
      resetCaptcha();
      return;
    }

    setLoading(true);
    setMessage({ type: 'info', text: t('submitting') });

    try {
      const response = await fetch('/api/waitlist/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          productId: product.id,
          productSlug: product.slug,
          captchaToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || t('signupFailed') });
        resetCaptcha();
        return;
      }

      setMessage({ type: 'success', text: t('signupSuccess') });
      setEmail('');
      setTermsAccepted(false);
    } catch {
      setMessage({ type: 'error', text: t('signupFailed') });
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gf-deep">
      <div className="max-w-4xl mx-auto p-8 bg-gf-raised/80 backdrop-blur-md border border-gf-border rounded-2xl">
        <div className="flex">
          {/* Product Info */}
          <div className="w-1/2 pr-8 border-r border-gf-border">
            <div className="flex items-center mb-6">
              <div className="text-5xl mr-6">{product.icon}</div>
              <div>
                <h1 className="text-2xl font-bold text-gf-heading">{product.name}</h1>
                <p className="text-gf-body">{product.description}</p>
              </div>
            </div>

            {/* Unavailable badge */}
            <div className="bg-gf-warning-soft border border-gf-warning/30 rounded-lg px-4 py-3">
              <div className="flex items-center">
                <svg className="h-5 w-5 text-gf-warning mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="text-gf-warning text-sm font-medium">
                  {getUnavailableMessage()}
                </span>
              </div>
            </div>
          </div>

          {/* Waitlist Form */}
          <div className="w-1/2 pl-8">
            <div className="bg-gf-raised backdrop-blur-md rounded-2xl p-6 border border-gf-border">
              <h2 className="text-xl font-semibold text-gf-heading mb-2">
                {t('joinWaitlist')}
              </h2>
              <p className="text-gf-body text-sm mb-4">
                {t('waitlistDescription')}
              </p>

              {message.type && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  message.type === 'success' ? 'bg-gf-success-soft border border-gf-success/30 text-gf-success' :
                  message.type === 'error' ? 'bg-gf-danger-soft border border-gf-danger/30 text-gf-danger' :
                  'bg-gf-accent-soft border border-gf-accent/30 text-gf-accent'
                }`}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handleWaitlistSubmit} className="space-y-4">
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
                    placeholder={t('enterEmailPlaceholder')}
                    required
                    disabled={loading}
                  />
                </div>

                {/* Terms and Conditions Checkbox */}
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
                    captchaLoading ||
                    !email ||
                    !termsAccepted ||
                    (process.env.NODE_ENV === 'production' && !captchaToken)
                  }
                  className="w-full bg-gf-accent-bg hover:bg-gf-accent-hover disabled:bg-gf-muted/30 disabled:cursor-not-allowed text-gf-heading font-semibold py-3 px-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gf-accent focus:ring-offset-2 active:scale-[0.98]"
                >
                  {loading || captchaLoading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                      {captchaLoading ? tSecurity('verifying') : t('submitting')}
                    </div>
                  ) : (
                    t('notifyMe')
                  )}
                </button>

                {/* Cloudflare Turnstile */}
                <div className="mt-3">
                  <TurnstileWidget
                    onVerify={(token) => {
                      setCaptchaToken(token);
                      setCaptchaLoading(false);
                    }}
                    onError={() => {
                      setCaptchaToken(null);
                      setCaptchaLoading(false);
                    }}
                    onTimeout={() => {
                      setCaptchaLoading(false);
                    }}
                    resetTrigger={captchaResetTrigger}
                    compact={true}
                  />
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
