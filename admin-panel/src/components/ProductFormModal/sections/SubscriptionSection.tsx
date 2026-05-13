'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import { CURRENCIES, getCurrencySymbol } from '@/lib/constants';
import type { SectionProps } from '../types';

interface SubscriptionSectionProps extends SectionProps {
  /** True when editing an existing product that has been sold at least once. */
  hasSales?: boolean;
}

const INTERVALS: Array<{ value: 'month' | 'year'; label: string }> = [
  { value: 'month', label: 'month' },
  { value: 'year', label: 'year' },
];

export function SubscriptionSection({ formData, setFormData, t, hasSales }: SubscriptionSectionProps) {
  const isSubscription = formData.product_type === 'subscription';

  const handleToggle = (next: 'one_time' | 'subscription') => {
    if (hasSales) return;
    setFormData((prev) => ({
      ...prev,
      product_type: next,
      // When switching to subscription, seed sensible defaults; otherwise clear.
      billing_interval: next === 'subscription' ? prev.billing_interval ?? 'month' : null,
      billing_interval_count: next === 'subscription' ? prev.billing_interval_count ?? 1 : null,
      recurring_price: next === 'subscription' ? prev.recurring_price ?? 0 : null,
      trial_days: next === 'subscription' ? prev.trial_days ?? null : null,
    }));
  };

  return (
    <ModalSection title={t('subscription.title', { defaultValue: 'Subscription' })}>
      <p className="text-xs text-sf-muted mb-3">
        {t('subscription.help', {
          defaultValue:
            'Subscription products bill on a recurring schedule. One-time products charge once.',
        })}
      </p>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => handleToggle('one_time')}
          disabled={hasSales}
          className={`px-4 py-2 border-2 text-sm ${
            !isSubscription
              ? 'border-sf-accent bg-sf-accent text-white'
              : 'border-sf-border-medium bg-sf-input text-sf-body'
          } ${hasSales ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {t('subscription.oneTime', { defaultValue: 'One-time' })}
        </button>
        <button
          type="button"
          onClick={() => handleToggle('subscription')}
          disabled={hasSales}
          className={`px-4 py-2 border-2 text-sm ${
            isSubscription
              ? 'border-sf-accent bg-sf-accent text-white'
              : 'border-sf-border-medium bg-sf-input text-sf-body'
          } ${hasSales ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {t('subscription.recurring', { defaultValue: 'Subscription' })}
        </button>
      </div>

      {hasSales && (
        <p className="text-xs text-amber-600 mb-3">
          {t('subscription.lockedAfterSale', {
            defaultValue: 'Type cannot be changed after the first sale.',
          })}
        </p>
      )}

      {isSubscription && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="recurring_price" className="block text-sm font-medium text-sf-body mb-1">
              {t('subscription.recurringPrice', { defaultValue: 'Recurring price' })}
            </label>
            <div className="relative">
              {formData.currency !== 'PLN' && formData.currency !== 'CHF' && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sf-muted pointer-events-none">
                  {getCurrencySymbol(formData.currency)}
                </div>
              )}
              <input
                type="number"
                id="recurring_price"
                min="0"
                step="0.01"
                value={formData.recurring_price ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    recurring_price: e.target.value === '' ? null : parseFloat(e.target.value),
                  }))
                }
                className={`w-full py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent text-sm ${
                  formData.currency !== 'PLN' && formData.currency !== 'CHF' ? 'pl-9' : 'pl-3'
                } pr-[4.5rem]`}
              />
              <select
                id="subscription_currency"
                value={formData.currency}
                onChange={(e) => setFormData((prev) => ({ ...prev, currency: e.target.value }))}
                className="absolute right-0 top-0 h-full w-[4.25rem] border-l border-sf-border bg-sf-raised px-2 text-xs font-medium text-sf-body focus:outline-none focus:ring-2 focus:ring-sf-accent"
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-xs text-sf-muted">
              {t('subscription.recurringPriceHelp', {
                defaultValue: 'Charged each billing period. Uses the product currency.',
              })}
            </p>
          </div>

          <div>
            <label htmlFor="billing_interval" className="block text-sm font-medium text-sf-body mb-1">
              {t('subscription.billingInterval', { defaultValue: 'Billing interval' })}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                id="billing_interval_count"
                min="1"
                step="1"
                value={formData.billing_interval_count ?? 1}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    billing_interval_count: Math.max(1, parseInt(e.target.value, 10) || 1),
                  }))
                }
                className="w-20 px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent text-sm"
              />
              <select
                id="billing_interval"
                value={formData.billing_interval ?? 'month'}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    billing_interval: e.target.value as 'month' | 'year',
                  }))
                }
                className="flex-1 px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent text-sm"
              >
                {INTERVALS.map((iv) => (
                  <option key={iv.value} value={iv.value}>
                    {t(`subscription.interval.${iv.value}`, { defaultValue: iv.label })}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-xs text-sf-muted">
              {t('subscription.billingIntervalHelp', {
                defaultValue: 'e.g. 1 month, 3 months, 1 year.',
              })}
            </p>
          </div>

          <div>
            <label htmlFor="trial_days" className="block text-sm font-medium text-sf-body mb-1">
              {t('subscription.trialDays', { defaultValue: 'Trial period (days)' })}
            </label>
            <input
              type="number"
              id="trial_days"
              min="0"
              max="730"
              step="1"
              placeholder="0"
              value={formData.trial_days ?? ''}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  trial_days: e.target.value === '' ? null : parseInt(e.target.value, 10),
                }))
              }
              className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent text-sm"
            />
            <p className="mt-1 text-xs text-sf-muted">
              {t('subscription.trialDaysHelp', {
                defaultValue: 'Optional. 0 or empty = no trial. Max 730.',
              })}
            </p>
          </div>
        </div>
      )}
    </ModalSection>
  );
}
