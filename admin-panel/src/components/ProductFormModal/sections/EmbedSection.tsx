'use client';

import React from 'react';
import type { SectionProps } from '@/components/ProductFormModal/types';

export function EmbedSection({
  formData,
  setFormData,
  t,
}: SectionProps) {
  const enabled = !!formData.embed_enabled;

  return (
    <div className="space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              embed_enabled: e.target.checked,
            }))}
            className="mt-1 h-4 w-4 text-sf-accent border-sf-border-medium focus:ring-sf-accent rounded"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-sf-heading">
              {t('embedSection.toggleLabel')}
            </div>
            <div className="text-xs text-sf-muted mt-1">
              {t('embedSection.toggleHelp')}
            </div>
          </div>
        </label>

        <fieldset className="space-y-3 border-t border-sf-border pt-4">
          <legend className="text-sm font-medium">{t('embedSection.leadTitle')}</legend>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={formData.lead_consent_required} onChange={e => { const checked = e.target.checked; setFormData(prev => ({ ...prev, lead_consent_required: checked })); }} />
            <span>{t('embedSection.leadRequired')}</span>
          </label>
          <p className="text-xs text-sf-muted">{t('embedSection.leadRisk')}</p>
          {(['lead_consent_version', 'lead_consent_text_pl', 'lead_consent_text_en'] as const).map((field, index) => (
            <label key={field} className="block text-sm">
              {t(`embedSection.${['leadVersion', 'leadTextPl', 'leadTextEn'][index]}`)}
              <input type="text" value={formData[field]} maxLength={index === 0 ? 60 : 500} required
                onChange={e => { const value = e.target.value; setFormData(prev => ({ ...prev, [field]: value })); }}
                className="mt-1 w-full rounded border border-sf-border-medium bg-sf-input p-2" />
            </label>
          ))}
        </fieldset>

        {enabled && (
          <p className="mt-2 text-xs text-sf-warning">
            {t('embedSection.tosDashboardNote')}
          </p>
        )}

        {enabled && (
          <div className="bg-sf-info-soft border border-sf-info/20 p-4 rounded">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-sf-info flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-sf-info">
                <p className="font-medium">{t('embedSection.nextStepTitle')}</p>
                <p className="mt-1">{t('embedSection.nextStepBody')}</p>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
