'use client';

import React from 'react';
import type { SectionProps } from '@/components/ProductFormModal/types';

/** Consent the visitor gives in the lead form before receiving the material. @see @/lib/leads/server */
export function LeadConsentSection({ formData, setFormData, t }: SectionProps) {
  return (
    <fieldset className="space-y-3">
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
  );
}
