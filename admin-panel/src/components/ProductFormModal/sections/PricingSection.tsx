'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import IconSelector from '@/components/IconSelector';
import { PricingSectionProps } from '../types';

interface VisualSectionProps {
  formData: PricingSectionProps['formData'];
  setFormData: PricingSectionProps['setFormData'];
  t: PricingSectionProps['t'];
  onIconSelect: (icon: string) => void;
}

export function PricingSection({
  formData,
  setFormData,
  t,
  onIconSelect,
}: VisualSectionProps) {
  const handleImageUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      image_url: e.target.value || null
    }));
  };

  return (
    <ModalSection title={t('visual')}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gf-body mb-2">
            {t('productIcon')}
          </label>
          <IconSelector
            selectedIcon={formData.icon}
            onSelectIcon={onIconSelect}
          />
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="image_url" className="block text-sm font-medium text-gf-body mb-2">
          {t('imageUrl')}
        </label>
        <input
          type="url"
          id="image_url"
          name="image_url"
          value={formData.image_url || ''}
          onChange={handleImageUrlChange}
          className="w-full px-4 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
          placeholder={t('imageUrlPlaceholder')}
        />
        <p className="mt-2 text-xs text-gf-muted">
          {t('imageUrlHelp')}
        </p>
      </div>
    </ModalSection>
  );
}
