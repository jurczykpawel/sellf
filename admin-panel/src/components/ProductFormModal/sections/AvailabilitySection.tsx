'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import DateTimePicker from '@/components/ui/DateTimePicker';
import { AvailabilitySectionProps } from '../types';

export function AvailabilitySection({
  formData,
  setFormData,
  t,
  hasWaitlistWebhook,
}: AvailabilitySectionProps) {
  const router = useRouter();
  const locale = useLocale();

  const isWaitlistDisabled = hasWaitlistWebhook === false;
  return (
    <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DateTimePicker
            label={t('availableFrom')}
            value={formData.available_from || ''}
            onChange={(value) => setFormData(prev => ({ ...prev, available_from: value }))}
            placeholder={t('selectStartDate')}
            description={t('productAvailableFrom')}
            showTimeSelect={true}
          />

          <DateTimePicker
            label={t('availableUntil')}
            value={formData.available_until || ''}
            onChange={(value) => setFormData(prev => ({ ...prev, available_until: value }))}
            placeholder={t('selectEndDate')}
            description={t('productUnavailableAfter')}
            showTimeSelect={true}
            minDate={formData.available_from ? new Date(formData.available_from) : undefined}
          />
        </div>

        {/* Waitlist signup option */}
        <div className="border-t border-sf-border pt-4">
          <label className={`flex items-center gap-3 ${isWaitlistDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={formData.enable_waitlist}
              onChange={(e) => setFormData(prev => ({ ...prev, enable_waitlist: e.target.checked }))}
              disabled={isWaitlistDisabled}
              className="h-4 w-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div>
              <span className="text-sm font-medium text-sf-body">
                {t('waitlist.enableWaitlist')}
              </span>
              <p className="text-xs text-sf-muted mt-0.5">
                {t('waitlist.enableWaitlistDescription')}
              </p>
            </div>
          </label>
          {isWaitlistDisabled && (
            <div data-testid="waitlist-webhook-warning" className="mt-2 p-3 bg-sf-warning-soft border border-sf-warning/20">
              <p className="text-sm text-sf-warning">
                {t('waitlist.noWebhookWarning')}{' '}
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/dashboard/webhooks`)}
                  className="underline font-medium hover:text-sf-warning"
                >
                  {t('waitlistWarning.configureWebhook')}
                </button>
              </p>
            </div>
          )}
        </div>

        <div className="bg-sf-accent-soft border border-sf-accent/20 p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-sf-accent" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-sf-accent">{t('temporalAvailabilityTitle')}</h4>
              <p className="text-sm text-sf-accent mt-1">
                {t('temporalAvailabilityDescription')}
              </p>
            </div>
          </div>
        </div>
    </div>
  );
}
