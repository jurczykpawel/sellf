'use client';

import { useTranslations } from 'next-intl';
import { RefreshCw, Check } from 'lucide-react';
import { KNOWN_PAYMENT_METHODS } from '@/lib/stripe/payment-method-configs';
import { getPaymentMethodDisplayInfo } from '@/lib/utils/payment-method-display';
import type { StripePaymentMethodConfig } from '@/types/payment-config';

interface StripePmcSelectorProps {
  stripePmcs: StripePaymentMethodConfig[];
  stripePmcsLoading: boolean;
  refreshing: boolean;
  stripePmcId: string;
  onSelect: (id: string, name: string) => void;
  onRefresh: () => void;
}

export default function StripePmcSelector({
  stripePmcs,
  stripePmcsLoading,
  refreshing,
  stripePmcId,
  onSelect,
  onRefresh,
}: StripePmcSelectorProps) {
  const t = useTranslations('settings');

  const selectedPmc = stripePmcs.find(pmc => pmc.id === stripePmcId);

  const enabledMethods: string[] = [];
  if (selectedPmc) {
    KNOWN_PAYMENT_METHODS.forEach(method => {
      const methodConfig = selectedPmc[method as keyof typeof selectedPmc] as { enabled?: boolean } | undefined;
      if (methodConfig?.enabled) enabledMethods.push(method);
    });
  }

  return (
    <div className="mb-8 p-4 bg-sf-raised">
      <label className="block text-sm font-medium text-sf-body mb-3">
        {t('paymentMethods.stripeConfig.title')}
      </label>
      <div className="flex gap-2">
        <select
          value={stripePmcId}
          onChange={(e) => {
            const pmc = stripePmcs.find(p => p.id === e.target.value);
            onSelect(e.target.value, pmc?.name || '');
          }}
          className="flex-1 px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading"
          disabled={stripePmcsLoading}
          aria-label={t('paymentMethods.stripeConfig.title')}
        >
          <option value="">{t('paymentMethods.stripeConfig.selectPlaceholder')}</option>
          {stripePmcs.map(pmc => (
            <option key={pmc.id} value={pmc.id}>
              {pmc.name} ({pmc.id})
            </option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-4 py-2 bg-sf-raised text-sf-body hover:bg-sf-hover transition-colors disabled:opacity-50"
          title={t('paymentMethods.stripeConfig.refresh')}
        >
          <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {stripePmcsLoading && (
        <p className="text-sm text-sf-body mt-2">{t('paymentMethods.stripeConfig.refreshing')}</p>
      )}

      {/* Preview enabled payment methods */}
      {stripePmcId && !stripePmcsLoading && selectedPmc && (
        <div className="mt-4 p-3 bg-sf-base border-2 border-sf-border-medium">
          <p className="text-sm font-medium text-sf-body mb-2">
            {t('paymentMethods.stripeConfig.preview')}
          </p>
          {enabledMethods.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {enabledMethods.map(method => {
                const info = getPaymentMethodDisplayInfo(method);
                return (
                  <span
                    key={method}
                    className="inline-flex items-center px-2.5 py-1 bg-sf-success-soft text-sf-success text-sm border border-sf-success/20"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    <span className="mr-1">{info.icon}</span>
                    {info.name}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-sf-muted">
              {t('paymentMethods.stripeConfig.noMethodsEnabled')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
