'use client';

import { useTranslations } from 'next-intl';

interface ExpressCheckoutTogglesProps {
  enableExpressCheckout: boolean;
  enableApplePay: boolean;
  enableGooglePay: boolean;
  enableLink: boolean;
  onUpdate: (updates: { enabled?: boolean; applePay?: boolean; googlePay?: boolean; link?: boolean }) => void;
}

export default function ExpressCheckoutToggles({
  enableExpressCheckout,
  enableApplePay,
  enableGooglePay,
  enableLink,
  onUpdate,
}: ExpressCheckoutTogglesProps) {
  const t = useTranslations('settings');

  return (
    <div className="mb-8 p-4 bg-sf-raised">
      <label className="block text-sm font-medium text-sf-body mb-3">
        {t('paymentMethods.expressCheckout.title')}
      </label>
      <div className="space-y-3">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={enableExpressCheckout}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="h-4 w-4 text-sf-accent"
          />
          <span className="ml-3 text-sf-heading font-medium">
            {t('paymentMethods.expressCheckout.enable')}
          </span>
        </label>
        {enableExpressCheckout && (
          <div className="ml-7 space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={enableApplePay}
                onChange={(e) => onUpdate({ applePay: e.target.checked })}
                className="h-4 w-4 text-sf-accent"
              />
              <span className="ml-3 text-sf-body">{t('paymentMethods.expressCheckout.applePay')}</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={enableGooglePay}
                onChange={(e) => onUpdate({ googlePay: e.target.checked })}
                className="h-4 w-4 text-sf-accent"
              />
              <span className="ml-3 text-sf-body">{t('paymentMethods.expressCheckout.googlePay')}</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={enableLink}
                onChange={(e) => onUpdate({ link: e.target.checked })}
                className="h-4 w-4 text-sf-accent"
              />
              <span className="ml-3 text-sf-body">{t('paymentMethods.expressCheckout.link')}</span>
            </label>
            {enableLink && (
              <p className="ml-7 mt-1 text-xs text-sf-muted">
                {t('paymentMethods.expressCheckout.linkEnabledDescription', { defaultValue: 'Link is displayed as part of the email field. Users with a Link account can pay with saved cards.' })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
