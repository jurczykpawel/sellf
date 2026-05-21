'use client';

import React from 'react';
import { RefundSectionProps } from '../types';

export function RefundSection({
  formData,
  setFormData,
  t,
}: RefundSectionProps) {
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  return (
    <div className="space-y-4">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="is_refundable"
            name="is_refundable"
            checked={formData.is_refundable}
            onChange={handleCheckboxChange}
            className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
          />
          <label htmlFor="is_refundable" className="ml-3 block text-sm font-medium text-sf-heading">
            {t('refundSettings.allowRefunds', { defaultValue: 'Allow customers to request refunds' })}
          </label>
        </div>

        {formData.is_refundable && (
          <div className="ml-7 space-y-4">
            <div>
              <label htmlFor="refund_period_days" className="block text-sm font-medium text-sf-body mb-2">
                {t('refundSettings.refundPeriod', { defaultValue: 'Refund period (days)' })}
                <span className="text-xs text-sf-muted ml-1">({t('optional')})</span>
              </label>
              <input
                type="number"
                id="refund_period_days"
                name="refund_period_days"
                value={formData.refund_period_days || ''}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  refund_period_days: e.target.value ? Number(e.target.value) : null
                }))}
                min="1"
                max="365"
                className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
                placeholder={t('refundSettings.refundPeriodPlaceholder', { defaultValue: 'e.g., 14, 30' })}
              />
              <p className="mt-1 text-xs text-sf-muted">
                {t('refundSettings.refundPeriodHelp', { defaultValue: 'Number of days from purchase within which customer can request a refund. Leave empty for no time limit.' })}
              </p>
            </div>

            <div className="bg-sf-accent-soft border border-sf-accent/20 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-sf-accent" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-sf-accent">
                    {t('refundSettings.infoTitle', { defaultValue: 'How refunds work' })}
                  </h4>
                  <p className="text-sm text-sf-accent mt-1">
                    {t('refundSettings.infoDescription', { defaultValue: 'Customers can submit refund requests from their purchase history. You will review and approve/reject each request. Admins can always issue refunds regardless of the time limit.' })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
