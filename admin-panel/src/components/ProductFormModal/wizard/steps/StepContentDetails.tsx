'use client';

import React from 'react';
import {
  ContentDeliverySection,
  PricingSection,
  CategoriesSection,
  DescriptionSection,
} from '../../sections';
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
  fieldErrors?: Record<string, string>;
  setFieldErrors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
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
  fieldErrors,
  setFieldErrors,
}) => {
  const isTipJar = formData.checkout_template === 'tip-jar';
  return (
    <div className="space-y-6">
      <DescriptionSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
      />

      {!isTipJar && (
        <ContentDeliverySection
          formData={formData}
          setFormData={setFormData}
          t={t}
          urlValidation={urlValidation}
          setUrlValidation={setUrlValidation}
          validateContentItemUrl={validateContentItemUrl}
        />
      )}

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
