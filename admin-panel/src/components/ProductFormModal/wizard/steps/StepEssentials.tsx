'use client';

import React from 'react';
import { BasicInfoSection, PriceVatInline, SubscriptionSection } from '../../sections';
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
  /** True when editing an existing product — UI lock on product_type. Backend
   * (PATCH /api/v1/products/[id]) is the authoritative gate. */
  isEditing?: boolean;
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
  isEditing,
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

      <SubscriptionSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        hasSales={isEditing}
      />

      {formData.product_type !== 'subscription' && (
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
      )}
    </div>
  );
};
