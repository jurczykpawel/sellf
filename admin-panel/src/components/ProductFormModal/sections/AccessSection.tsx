'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import { AccessSectionProps } from '../types';

export function AccessSection({
  formData,
  setFormData,
  t,
}: AccessSectionProps) {
  return (
    <ModalSection title={t('autoGrantAccessSettings')} collapsible defaultExpanded={!!formData.auto_grant_duration_days}>
      <div className="space-y-4">
        <div>
          <label htmlFor="auto-grant-duration" className="block text-sm font-medium text-gf-body mb-2">
            {t('defaultAccessDuration')}
            <span className="text-xs text-gf-muted ml-1">({t('optional')})</span>
          </label>
          <input
            type="number"
            id="auto-grant-duration"
            name="auto_grant_duration_days"
            value={formData.auto_grant_duration_days || ''}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              auto_grant_duration_days: e.target.value ? Number(e.target.value) : null
            }))}
            min="1"
            className="w-full px-3 py-2.5 border border-gf-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent bg-gf-input text-gf-heading"
            placeholder={t('durationPlaceholder')}
          />
          <p className="mt-1 text-xs text-gf-muted">
            {t('accessExpireAfter')}
          </p>
        </div>

        <div className="bg-gf-warning-soft border border-gf-warning/20 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-gf-warning" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-gf-warning">{t('autoGrantDurationTitle')}</h4>
              <p className="text-sm text-gf-warning mt-1">
                {t('autoGrantDurationDescription')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </ModalSection>
  );
}
