/**
 * Payment Method Configuration Settings
 *
 * Admin UI for configuring global payment method settings.
 * Supports three modes: automatic, Stripe preset, custom
 *
 * @see /supabase/migrations/20260116000000_payment_method_configuration.sql
 * @see /admin-panel/src/lib/actions/payment-config.ts
 *
 * SECURITY: XSS Protection
 * - All string values (stripe_pmc_name, payment method labels) are rendered
 * via JSX which auto-escapes HTML entities by default
 * - No dangerouslySetInnerHTML is used in this component
 * - User input is validated via Zod schemas before storage (see payment-config.ts)
 */

'use client';

import { useTranslations } from 'next-intl';
import { RefreshCw, Check, RotateCcw } from 'lucide-react';
import { usePaymentMethodConfig } from '@/hooks/usePaymentMethodConfig';
import { useStripePmcs } from '@/hooks/useStripePmcs';
import PaymentModeSelector from './PaymentModeSelector';
import StripePmcSelector from './StripePmcSelector';
import CustomMethodsList from './CustomMethodsList';
import CurrencyOverrides from './CurrencyOverrides';
import ExpressCheckoutToggles from './ExpressCheckoutToggles';

export default function PaymentMethodSettings() {
  const t = useTranslations('settings');
  const cfg = usePaymentMethodConfig();
  const pmcs = useStripePmcs();

  if (cfg.loading) {
    return (
      <div className="bg-sf-base border-2 border-sf-border-medium p-6">
        <h3 className="text-xl font-semibold text-sf-heading mb-4">
          {t('paymentMethods.title')}
        </h3>
        <p className="text-sf-body">{t('paymentMethods.buttons.loading')}</p>
      </div>
    );
  }

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium p-6">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-sf-heading mb-2">
          {t('paymentMethods.title')}
        </h3>
        <p className="text-sm text-sf-body">{t('paymentMethods.subtitle')}</p>
      </div>

      {/* Configuration Mode */}
      <PaymentModeSelector
        configMode={cfg.configMode}
        pmSource={cfg.pmSource}
        pmEnvExists={cfg.pmEnvExists}
        onChange={(mode) => cfg.handleModeChange(mode, pmcs.loadStripePmcs)}
      />

      {/* Stripe Preset Selector */}
      {cfg.configMode === 'stripe_preset' && (
        <StripePmcSelector
          stripePmcs={pmcs.stripePmcs}
          stripePmcsLoading={pmcs.stripePmcsLoading}
          refreshing={pmcs.refreshing}
          stripePmcId={cfg.stripePmcId}
          onSelect={cfg.selectStripePmc}
          onRefresh={pmcs.handleRefreshStripePmcs}
        />
      )}

      {/* Custom Methods + Order */}
      {cfg.configMode === 'custom' && (
        <CustomMethodsList
          customPaymentMethods={cfg.customPaymentMethods}
          paymentMethodOrder={cfg.paymentMethodOrder}
          onToggle={cfg.togglePaymentMethod}
          onOrderChange={cfg.setPaymentMethodOrder}
        />
      )}

      {/* Express Checkout Toggles */}
      <ExpressCheckoutToggles
        enableExpressCheckout={cfg.enableExpressCheckout}
        enableApplePay={cfg.enableApplePay}
        enableGooglePay={cfg.enableGooglePay}
        enableLink={cfg.enableLink}
        onUpdate={cfg.updateExpressCheckout}
      />

      {/* Currency Overrides */}
      <CurrencyOverrides
        currencyOverrides={cfg.currencyOverrides}
        customPaymentMethods={cfg.customPaymentMethods}
        paymentMethodOrder={cfg.paymentMethodOrder}
        showCurrencyOverrides={cfg.showCurrencyOverrides}
        onToggleShow={cfg.setShowCurrencyOverrides}
        onOverridesChange={cfg.setCurrencyOverrides}
      />

      {/* Recommended Configuration */}
      <div className="mb-8 p-4 bg-sf-accent-soft border border-sf-border-accent">
        <div className="flex items-start justify-between">
          <div>
            <label className="block text-sm font-medium text-sf-accent mb-1">
              {t('paymentMethods.recommended.title')}
            </label>
            <p className="text-sm text-sf-accent">
              {t('paymentMethods.recommended.description')}
            </p>
            <p className="text-xs text-sf-accent mt-1">
              {t('paymentMethods.recommended.features')}
            </p>
          </div>
          <button
            onClick={cfg.handleResetToRecommended}
            disabled={cfg.resettingToRecommended || cfg.saving}
            className="px-4 py-2 bg-sf-accent-bg text-white text-sm hover:bg-sf-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            {cfg.resettingToRecommended ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {t('paymentMethods.buttons.loading')}
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                {t('paymentMethods.recommended.reset')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={cfg.handleReset}
          disabled={cfg.saving}
          className="px-4 py-2 border-2 border-sf-border-medium text-sf-body hover:bg-sf-hover transition-colors disabled:opacity-50"
        >
          {t('paymentMethods.buttons.reset')}
        </button>
        <button
          onClick={cfg.handleSave}
          disabled={cfg.saving}
          className="px-6 py-2 bg-sf-accent-bg text-white hover:bg-sf-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {cfg.saving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              {t('paymentMethods.buttons.saving')}
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              {t('paymentMethods.buttons.save')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
