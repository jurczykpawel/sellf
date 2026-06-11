'use client';

import React from 'react';
import { Lock } from 'lucide-react';
import { AccessSectionProps } from '../types';

export function LicenseSection({ formData, setFormData, t, hasLicenseIssuance = true }: AccessSectionProps) {
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
              maxLength={80}
              className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
              placeholder={t('license.tierPlaceholder')}
            />
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
              onChange={(e) =>
                setFormData(prev => ({
                  ...prev,
                  license_duration_days: e.target.value ? Number(e.target.value) : null,
                }))
              }
              min="1"
              className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
              placeholder={t('license.durationPlaceholder')}
            />
            <p className="mt-1 text-xs text-sf-muted">{t('license.durationHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
