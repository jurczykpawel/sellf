'use client';

import React from 'react';
import { ContentDeliverySection, PricingSection, CategoriesSection } from '../../sections';
import type { ProductFormData, TranslationFunction, UrlValidation } from '../../types';
import type { Category } from '@/lib/actions/categories';

interface StepContentDetailsProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
  onIconSelect: (icon: string) => void;
  urlValidation: Record<number, UrlValidation>;
  setUrlValidation: React.Dispatch<React.SetStateAction<Record<number, UrlValidation>>>;
  validateContentItemUrl: (url: string, type: 'video_embed' | 'download_link') => UrlValidation;
  allCategories: Category[];
  loadingCategories: boolean;
}

export const StepContentDetails: React.FC<StepContentDetailsProps> = ({
  formData,
  setFormData,
  t,
  onIconSelect,
  urlValidation,
  setUrlValidation,
  validateContentItemUrl,
  allCategories,
  loadingCategories,
}) => {
  return (
    <div className="space-y-6">
      <ContentDeliverySection
        formData={formData}
        setFormData={setFormData}
        t={t}
        urlValidation={urlValidation}
        setUrlValidation={setUrlValidation}
        validateContentItemUrl={validateContentItemUrl}
      />

      <PricingSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        onIconSelect={onIconSelect}
      />

      <CategoriesSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        allCategories={allCategories}
        loadingCategories={loadingCategories}
      />
    </div>
  );
};
