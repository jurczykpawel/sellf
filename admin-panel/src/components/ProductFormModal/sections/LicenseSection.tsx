'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { productFieldErrorMessage } from '@/components/ProductFormModal/field-error-message';
import { Lock } from 'lucide-react';
import { licenseDurationError, MAX_LICENSE_DURATION_DAYS } from '@/lib/validations/product';
import type { AccessSectionProps } from '@/components/ProductFormModal/types';

export function LicenseSection({ formData, setFormData, t, hasLicenseIssuance = true, fieldErrors = {}, setFieldErrors }: AccessSectionProps) {
  const locale = useLocale();
  const durationError = fieldErrors.license_duration_days;
  if (!hasLicenseIssuance) {
    return (
      <div className="flex items-start gap-3 p-4 bg-sf-raised border border-sf-border rounded opacity-75">
        <Lock className="w-4 h-4 text-sf-muted mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-sf-heading">{t('license.proRequired')}</p>
          <p className="text-xs text-sf-muted mt-0.5">{t('license.proRequiredHint')}</p>
        </div>
      </div>
    );
  }

  const enabled = formData.issue_license_on_purchase;

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="issue_license_on_purchase"
          checked={enabled}
          onChange={(e) =>
            setFormData(prev => ({ ...prev, issue_license_on_purchase: e.target.checked }))
          }
          className="mt-1 h-4 w-4 text-sf-accent border-sf-border-medium focus:ring-sf-accent"
        />
        <span>
          <span className="block text-sm font-medium text-sf-heading">{t('license.toggleLabel')}</span>
          <span className="block text-xs text-sf-muted mt-0.5">{t('license.toggleHint')}</span>
        </span>
      </label>

      {enabled && (
        <div className="space-y-4 pl-7">
          <div>
            <label htmlFor="license-tier" className="block text-sm font-medium text-sf-body mb-2">
              {t('license.tierLabel')}
              <span className="text-xs text-sf-muted ml-1">({t('optional')})</span>
            </label>
            <input
              type="text"
              id="license-tier"
              name="license_tier"
              value={formData.license_tier || ''}
              onChange={(e) =>
                setFormData(prev => ({ ...prev, license_tier: e.target.value || null }))
              }
              aria-invalid={!!fieldErrors.license_tier}
              aria-describedby={fieldErrors.license_tier ? 'license-tier-error' : undefined}
              className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
              placeholder={t('license.tierPlaceholder')}
            />
            {fieldErrors.license_tier && <p id="license-tier-error" role="alert" className="text-xs text-sf-danger">{productFieldErrorMessage('license_tier', locale)}</p>}
            <p className="mt-1 text-xs text-sf-muted">{t('license.tierHint')}</p>
          </div>

          <div>
            <label htmlFor="license-duration" className="block text-sm font-medium text-sf-body mb-2">
              {t('license.durationLabel')}
              <span className="text-xs text-sf-muted ml-1">({t('optional')})</span>
            </label>
            <input
              type="number"
              id="license-duration"
              name="license_duration_days"
              value={formData.license_duration_days ?? ''}
              onChange={(e) => {
                if (durationError) setFieldErrors?.(prev => { const next = { ...prev }; delete next.license_duration_days; return next; });
                setFormData(prev => ({
                  ...prev,
                  license_duration_days: e.target.value ? Number(e.target.value) : null,
                }));
              }}
              onBlur={() => {
                if (licenseDurationError(formData.license_duration_days)) setFieldErrors?.(prev => ({ ...prev, license_duration_days: 'license_duration' }));
              }}
              aria-invalid={durationError ? true : undefined}
              aria-describedby={durationError ? 'license-duration-error' : undefined}
              min="1"
              max={MAX_LICENSE_DURATION_DAYS}
              step="1"
              className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
              placeholder={t('license.durationPlaceholder')}
            />
            {durationError
              ? <p id="license-duration-error" role="alert" className="mt-1 text-xs text-sf-danger">{t('license.durationInvalid', { max: MAX_LICENSE_DURATION_DAYS })}</p>
              : <p className="mt-1 text-xs text-sf-muted">{t('license.durationHint')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
