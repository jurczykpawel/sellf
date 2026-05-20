'use client';

import React from 'react';
import {
  BasicInfoSection,
  PriceVatInline,
  SubscriptionSection,
  ProductTypeRadio,
} from '../../sections';
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
  /** True when editing an existing product — type radio is locked. */
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
  const isLeadMagnet =
    formData.product_type === 'one_time' &&
    formData.checkout_template !== 'tip-jar' &&
    formData.price === 0 &&
    !formData.allow_custom_price;

  const showPriceInput = formData.product_type !== 'subscription' && !isLeadMagnet;

  return (
    <div className="space-y-6">
      <ProductTypeRadio
        formData={formData}
        setFormData={setFormData}
        isEditing={isEditing}
      />

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

      <SubscriptionSection formData={formData} setFormData={setFormData} t={t} />

      {showPriceInput && (
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

      {isLeadMagnet && (
        <p className="text-sm text-sf-info bg-sf-info-soft p-3 rounded">
          {t('productType.leadMagnetNotice')}
        </p>
      )}
    </div>
  );
};
