'use client';

import React from 'react';
import { SectionProps } from '../types';

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
