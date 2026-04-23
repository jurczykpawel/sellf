'use client';

import { useTranslations } from 'next-intl';
import type { Product } from '@/types';
import type { User } from '@supabase/supabase-js';
import { formatPrice, STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';
import CaptchaWidget from '@/components/captcha/CaptchaWidget';
import TermsCheckbox from '@/components/TermsCheckbox';

/** Narrow props — only what PwywSection actually needs from useFreeAccess */
interface PwywFreeAccessProps {
  pwywFreeEmail: string;
  setPwywFreeEmail: (email: string) => void;
  pwywFreeTermsAccepted: boolean;
  setPwywFreeTermsAccepted: (accepted: boolean) => void;
  pwywFreeLoading: boolean;
  pwywFreeMessage: { type: 'info' | 'success' | 'error'; text: string } | null;
  handlePwywFreeAccess: () => Promise<void>;
  handlePwywFreeMagicLink: () => Promise<void>;
  captcha: {
    token: string | null;
    isLoading: boolean;
    onVerify: (token: string) => void;
    onError: () => void;
    onTimeout: () => void;
    resetTrigger: number;
  };
}

interface PwywSectionProps {
  product: Product;
  user: User | null;
  customAmount: number;
  customAmountInput: string;
  customAmountError: string | null;
  /** True when the user can claim this product for free — PWYW=0 OR a 100% coupon applied. */
  isFreeAccess: boolean;
  /** True only for the coupon-driven free flow. Controls copy (e.g. "redeem coupon"
   *  instead of "get for free") and hides the custom-amount picker. */
  isFullDiscountCoupon: boolean;
  hasAccess: boolean;
  error: string | null;
  pwyw: PwywFreeAccessProps;
  onAmountInputChange: (raw: string) => void;
  onAmountBlur: () => void;
  onPresetClick: (preset: number) => void;
}

export default function PwywSection({
  product,
  user,
  customAmount,
  customAmountInput,
  customAmountError,
  isFreeAccess,
  isFullDiscountCoupon,
  hasAccess,
  error,
  pwyw,
  onAmountInputChange,
  onAmountBlur,
  onPresetClick,
}: PwywSectionProps) {
  const t = useTranslations('checkout');
  const tSecurity = useTranslations('security');

  return (
    <>
      {/* Custom Price Selection — hide when a full-discount coupon is active
          (the amount is forced to 0, there's nothing to pick). */}
      {product.allow_custom_price && !isFullDiscountCoupon && !hasAccess && !error && (
        <div className="mb-6 p-5 bg-sf-raised backdrop-blur-sm rounded-2xl border border-sf-border">
          <h3 className="text-lg font-semibold text-sf-heading mb-3">{t('customPrice.title')}</h3>

          {/* Preset Buttons */}
          {product.show_price_presets &&
            product.custom_price_presets &&
            product.custom_price_presets.filter(
              p => p >= 0 && (p > 0 || (product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT) === 0)
            ).length > 0 && (
              <div className="flex gap-2 mb-3">
                {product.custom_price_presets
                  .filter(p => p >= 0 && (p > 0 || (product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT) === 0))
                  .map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onPresetClick(preset)}
                      className={`
                        px-4 py-2 rounded-lg border text-sm font-medium transition-all
                        ${customAmount === preset
                          ? 'bg-sf-accent-bg border-sf-accent text-white'
                          : 'bg-sf-raised border-sf-border text-sf-heading hover:bg-sf-hover'}
                      `}
                    >
                      {preset === 0 ? t('customPrice.freePreset') : formatPrice(preset, product.currency)}
                    </button>
                  ))}
              </div>
            )}

          {/* Custom Amount Input */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                inputMode="decimal"
                value={customAmountInput}
                onChange={(e) => {
                  const rawValue = e.target.value.replace(',', '.');
                  if (rawValue === '' || /^\d*\.?\d*$/.test(rawValue)) {
                    onAmountInputChange(rawValue);
                  }
                }}
                onBlur={onAmountBlur}
                placeholder={`${product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT}`}
                className={`
                  w-full px-4 py-3 bg-sf-input border rounded-lg text-lg font-semibold text-sf-heading
                  focus:outline-none focus:ring-2 focus:ring-sf-accent transition-all
                  ${customAmountError ? 'border-sf-danger' : 'border-sf-border'}
                `}
              />
            </div>
            <span className="text-lg font-medium text-sf-muted min-w-[50px]">
              {product.currency}
            </span>
          </div>

          {customAmountError && (
            <p className="text-sm text-sf-danger mt-2">{customAmountError}</p>
          )}

          <p className="text-xs text-sf-muted mt-2">
            {t('customPrice.minimum')}: {formatPrice(product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT, product.currency)} {product.currency}
          </p>
        </div>
      )}

      {/* Free-access section — shared by PWYW=0 and 100% coupon flows */}
      {isFreeAccess && !hasAccess && !error && (
        <div className="mb-6 p-5 bg-sf-success-soft rounded-2xl border border-sf-success/20">
          {user ? (
            <button
              type="button"
              onClick={pwyw.handlePwywFreeAccess}
              disabled={pwyw.pwywFreeLoading}
              className="w-full py-3 px-6 bg-sf-success hover:bg-sf-success/90 disabled:opacity-50 text-sf-inverse font-semibold rounded-full transition-all active:scale-[0.98]"
            >
              {pwyw.pwywFreeLoading
                ? '...'
                : isFullDiscountCoupon
                  ? t('customPrice.redeemCoupon')
                  : t('customPrice.getForFree')}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-sf-heading">
                {isFullDiscountCoupon ? t('customPrice.redeemCoupon') : t('customPrice.getForFree')}
              </p>
              <input
                type="email"
                value={pwyw.pwywFreeEmail}
                onChange={(e) => pwyw.setPwywFreeEmail(e.target.value)}
                placeholder={t('emailAddress')}
                className="w-full px-4 py-3 border border-sf-border rounded-lg bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
              />
              <TermsCheckbox
                checked={pwyw.pwywFreeTermsAccepted}
                onChange={pwyw.setPwywFreeTermsAccepted}
                termsUrl="/terms"
                privacyUrl="/privacy"
              />
              <button
                type="button"
                onClick={pwyw.handlePwywFreeMagicLink}
                disabled={
                  pwyw.pwywFreeLoading ||
                  pwyw.captcha.isLoading ||
                  !pwyw.pwywFreeEmail ||
                  !pwyw.pwywFreeTermsAccepted ||
                  (process.env.NODE_ENV === 'production' && !pwyw.captcha.token)
                }
                className="w-full py-3 px-6 bg-sf-success hover:bg-sf-success/90 disabled:opacity-50 text-sf-inverse font-semibold rounded-full transition-all active:scale-[0.98]"
              >
                {pwyw.pwywFreeLoading || pwyw.captcha.isLoading ? (
                  <span className="flex items-center justify-center">
                    <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                    {pwyw.captcha.isLoading ? tSecurity('verifying') : t('sendingMagicLink')}
                  </span>
                ) : t('sendMagicLink')}
              </button>
              <div className="mt-3">
                <CaptchaWidget
                  onVerify={pwyw.captcha.onVerify}
                  onError={pwyw.captcha.onError}
                  onTimeout={pwyw.captcha.onTimeout}
                  resetTrigger={pwyw.captcha.resetTrigger}
                  compact={true}
                />
              </div>
              {pwyw.pwywFreeMessage && (
                <p className={`text-sm ${pwyw.pwywFreeMessage.type === 'error' ? 'text-sf-danger' : pwyw.pwywFreeMessage.type === 'success' ? 'text-sf-success' : 'text-sf-muted'}`}>
                  {pwyw.pwywFreeMessage.text}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
