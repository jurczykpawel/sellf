'use client';

import React from 'react';
import { BasicInfoSection, PriceVatInline } from '../../sections';
import type { ProductFormData, TranslationFunction } from '../../types';
import type { TaxMode } from '@/lib/actions/shop-config';

interface StepEssentialsProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  slugModified: boolean;
  setSlugModified: (value: boolean) => void;
  currentDomain: string;
  generateSlug: (name: string) => string;
  fieldErrors?: Record<string, string>;
  setFieldErrors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  priceDisplayValue: string;
  setPriceDisplayValue: (value: string) => void;
  shopDefaultVatRate: number | null;
  taxMode?: TaxMode;
}

export const StepEssentials: React.FC<StepEssentialsProps> = ({
  formData,
  setFormData,
  t,
  nameInputRef,
  slugModified,
  setSlugModified,
  currentDomain,
  generateSlug,
  fieldErrors,
  setFieldErrors,
  priceDisplayValue,
  setPriceDisplayValue,
  shopDefaultVatRate,
  taxMode,
}) => {
  return (
    <div className="space-y-6">
      <BasicInfoSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        nameInputRef={nameInputRef}
        slugModified={slugModified}
        setSlugModified={setSlugModified}
        currentDomain={currentDomain}
        generateSlug={generateSlug}
        fieldErrors={fieldErrors}
      />

      <PriceVatInline
        formData={formData}
        setFormData={setFormData}
        t={t}
        priceDisplayValue={priceDisplayValue}
        setPriceDisplayValue={setPriceDisplayValue}
        shopDefaultVatRate={shopDefaultVatRate}
        taxMode={taxMode}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
      />
    </div>
  );
};
