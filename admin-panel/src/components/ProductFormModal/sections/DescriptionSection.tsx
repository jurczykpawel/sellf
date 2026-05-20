'use client';

import React, { useState } from 'react';
import { ModalSection } from '@/components/ui/Modal';
import type { SectionProps } from '../types';

interface DescriptionSectionProps extends SectionProps {
  fieldErrors?: Record<string, string>;
}

export function DescriptionSection({
  formData,
  setFormData,
  t,
  fieldErrors = {},
}: DescriptionSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const errorBorder = 'border-red-500 focus:ring-red-500';
  const normalBorder = 'border-sf-border focus:ring-sf-accent';

  return (
    <ModalSection title={t('descriptionSection.title', { defaultValue: 'Opis produktu' })}>
      <div className="space-y-4">
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-sf-body mb-2">
            {t('description')}
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description || ''}
            onChange={handleChange}
            rows={3}
            className={`w-full px-3 py-2.5 border ${
              fieldErrors.description ? errorBorder : normalBorder
            } focus:outline-none focus:ring-2 focus:border-transparent bg-sf-input text-sf-heading`}
            placeholder={t('descriptionPlaceholder')}
            required
          />
          {fieldErrors.description && (
            <p className="mt-1 text-xs text-red-500">{t('descriptionRequired')}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="long_description" className="block text-sm font-medium text-sf-body">
              {t('longDescription')}
              <span className="text-xs text-sf-muted ml-1">({t('optional')})</span>
            </label>
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-xs text-sf-accent hover:text-sf-accent flex items-center gap-1"
            >
              {expanded ? t('collapse') : t('expand')}
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  expanded ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>
          <textarea
            id="long_description"
            name="long_description"
            value={formData.long_description || ''}
            onChange={handleChange}
            rows={expanded ? 10 : 2}
            className="w-full px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading font-mono text-sm resize-none transition-all duration-200"
            placeholder={t('longDescriptionPlaceholder')}
          />
          {expanded && (
            <p className="mt-1.5 text-xs text-sf-muted flex items-start gap-1">
              <span>💡</span>
              <span>{t('markdownTip')}</span>
            </p>
          )}
        </div>
      </div>
    </ModalSection>
  );
}
