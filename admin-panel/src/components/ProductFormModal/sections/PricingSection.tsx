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
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('productIcon')}
          </label>
          <IconSelector
            selectedIcon={formData.icon}
            onSelectIcon={onIconSelect}
          />
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="image_url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('imageUrl')}
        </label>
        <input
          type="url"
          id="image_url"
          name="image_url"
          value={formData.image_url || ''}
          onChange={handleImageUrlChange}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="https://i.ibb.co/..."
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('imageUrlHelp')}
        </p>
      </div>
    </ModalSection>
  );
}
