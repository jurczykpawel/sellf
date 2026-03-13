import { useTranslations } from 'next-intl';
import Link from 'next/link';
import CaptchaWidget from '@/components/captcha/CaptchaWidget';
import TermsCheckbox from '@/components/TermsCheckbox';
import { Product } from '../types';

interface MagicLinkStatusProps {
  product: Product;
  customerEmail?: string;
  magicLinkSent: boolean;
  termsAccepted: boolean;
  captchaToken: string | null;
  captchaError: string | null;
  captchaTimeout: boolean;
  showInteractiveWarning: boolean;
  magicLinkError: string | null;
  onTermsAccept: () => void;
  onCaptchaSuccess: (token: string) => void;
  onCaptchaError: (error: string | null) => void;
  onCaptchaTimeout: () => void;
  onBeforeInteractive: () => void;
  onAfterInteractive: () => void;
  sendMagicLink: () => Promise<void>;
  /** Optional redirect URL - if set, show countdown after magic link is sent */
  redirectUrl?: string;
  /** Countdown value for redirect */
  countdown?: number;
}

export default function MagicLinkStatus({
  customerEmail,
  magicLinkSent,
  termsAccepted,
  captchaToken,
  captchaError,
  captchaTimeout,
  showInteractiveWarning,
  magicLinkError,
  onTermsAccept,
  onCaptchaSuccess,
  onCaptchaError,
  onCaptchaTimeout,
  onBeforeInteractive,
  onAfterInteractive,
  redirectUrl,
  countdown,
}: MagicLinkStatusProps) {
  const t = useTranslations('paymentStatus');
  const tCompliance = useTranslations('compliance');
  const tSecurity = useTranslations('security');

  // Terms are always accepted in checkout before reaching this page
  const termsOk = true;

  // Terms are always accepted in checkout, so never need custom terms checkbox here
  const needsCustomTerms = false;
  const needsTurnstile = !captchaToken;
  
  // Show validation block if:
  // 1. We need user action (terms or captcha)
  // 2. There's no captcha error AND no magic link error
  // 3. Magic link hasn't been sent yet
  // 4. Captcha became interactive (showInteractiveWarning is set by onBeforeInteractive)
  const showValidationBlock = !magicLinkSent && !captchaError && !magicLinkError && (
    needsCustomTerms || 
    (needsTurnstile && showInteractiveWarning) || 
    showInteractiveWarning
  );
  
  // SIMPLE: show spinner by default, hide it in 3 cases
  const shouldShowSpinner = customerEmail && 
                           termsOk && 
                           !magicLinkSent && 
                           !showValidationBlock &&
                           !captchaError &&
                           !magicLinkError; // Hide spinner when magic link fails

  return (
    <>
      <p className="text-sf-body mb-6">{t('paymentProcessedSuccessfully')}</p>
      
      <div className="space-y-4">
        {showValidationBlock ? (
          <div className="bg-sf-warning-soft border-2 border-sf-warning/30 rounded-xl p-6 mb-6">
            <h3 className="text-xl font-bold text-sf-warning mb-6">
              ⚠️ {tCompliance('beforeSendingLink')}
            </h3>
            
            {/* Terms and Conditions Checkbox - only if terms not already handled */}
            {needsCustomTerms && (
              <div className="mb-6">
                <TermsCheckbox
                  checked={termsAccepted}
                  onChange={onTermsAccept}
                  termsUrl="/terms"
                  privacyUrl="/privacy"
                  variant="default"
                />
              </div>
            )}

            {/* Captcha — show in yellow block when captcha became interactive */}
            {needsTurnstile && showInteractiveWarning && (
              <CaptchaWidget
                onVerify={(token) => {
                  onCaptchaSuccess(token);
                  onCaptchaError(null);
                  onAfterInteractive();
                }}
                onError={() => {
                  onCaptchaError(tSecurity('captchaVerificationFailed'));
                }}
                onTimeout={() => {
                  onCaptchaTimeout();
                  onCaptchaError(tSecurity('captchaTimeout'));
                }}
                onBeforeInteractive={onBeforeInteractive}
              />
            )}
            
          </div>
        ) : needsTurnstile && !showInteractiveWarning ? (
          // Always render captcha when token is needed (outside yellow block)
          <div className="hidden">
            <CaptchaWidget
              onVerify={onCaptchaSuccess}
              onError={() => onCaptchaError(tSecurity('captchaVerificationFailed'))}
              onTimeout={() => {
                onCaptchaTimeout();
                onCaptchaError(tSecurity('captchaTimeout'));
              }}
              onBeforeInteractive={onBeforeInteractive}
            />
          </div>
        ) : magicLinkSent ? (
          // Show success message if magic link was sent successfully
          <div className="bg-sf-success-soft border border-sf-success/30 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-sf-success mb-2">
              ✅ {t('magicLinkSent')}
            </h3>
            <p className="text-sf-success text-sm">
              {t('checkEmailForLoginLink', { email: customerEmail || '' })}
            </p>
            {/* Show countdown if redirect is configured */}
            {redirectUrl && countdown !== undefined && (
              <div className="mt-4 pt-4 border-t border-sf-success/20">
                <div className="flex items-center justify-center space-x-3">
                  <div className="text-4xl font-bold text-sf-heading tabular-nums">{countdown}</div>
                </div>
                <p className="text-sf-muted text-sm mt-2 text-center">{t('redirectingToProduct')}</p>
              </div>
            )}
          </div>
        ) : null}
        
        {/* SINGLE SPINNER OUTSIDE YELLOW BLOCK - shows in 2 cases */}
        {shouldShowSpinner && customerEmail && (
          <div className="bg-sf-accent-soft border border-sf-border-accent rounded-lg p-4 flex items-center justify-center mb-6">
            <div className="flex items-center space-x-3">
              <div className="animate-spin h-5 w-5 border-2 border-sf-accent border-t-transparent rounded-full"></div>
              <span className="text-sf-accent font-medium">
                {captchaToken ? t('sendingMagicLink') : 'Processing verification...'}
              </span>
            </div>
          </div>
        )}
        
        {/* Show captcha errors always (even for invisible captcha) */}
        {captchaError && (
          <div className="bg-sf-danger-soft border border-sf-danger/30 rounded-lg p-3 text-sm text-sf-danger mb-4">
            ❌ {captchaError}
            {captchaTimeout ? (
              <>
                {' '}{tSecurity('refreshPageOrLogin')}{' '}
                <Link href="/login?message=payment_completed_login_required" className="text-sf-accent hover:text-sf-accent-hover underline">
                  {tSecurity('tryLoggingInAgain')}
                </Link>
                .
              </>
            ) : (
              <>
                {' '}{tSecurity('captchaErrorLoginPrompt')}{' '}
                <Link href="/login?message=payment_completed_login_required" className="text-sf-accent hover:text-sf-accent-hover underline">
                  {tSecurity('tryLoggingInAgain')}
                </Link>
                .
              </>
            )}
          </div>
        )}
        
        {/* Show magic link errors */}
        {magicLinkError && (
          <div className="bg-sf-danger-soft border border-sf-danger/30 rounded-lg p-3 text-sm text-sf-danger mb-4">
            ❌ {magicLinkError}
            <div className="mt-3">
              <Link 
                href="/login?message=payment_completed_login_required" 
                className="inline-block px-4 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white text-sm rounded transition-colors"
              >
                {t('goToLoginPage')}
              </Link>
            </div>
          </div>
        )}
        
        {!captchaError && !magicLinkError && (
        <div className="bg-sf-accent-soft border border-sf-border-accent rounded-lg p-4 animate-fadeInPulse">
          <h3 className="text-lg font-semibold text-sf-accent mb-2 animate-pulse">
            🎯 {t('toAccessYourProduct')}
          </h3>
          <div className="text-sm text-sf-body space-y-2">
            <p className="animate-slideInLeft delay-100">{t('step1CheckEmail', { email: customerEmail ? `(${customerEmail})` : '' })}</p>
            <p className="animate-slideInLeft delay-200">{t('step2ClickMagicLink')}</p>
            <p className="animate-slideInLeft delay-300">{t('step3AutoRedirect')}</p>
          </div>
        </div>
        )}
        <p className="text-sf-muted text-sm">
          {t('didNotReceiveEmail')}
        </p>
      </div>
    </>
  );
}
