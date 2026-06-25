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
  const uxType = formData.ux_product_type;
  const isLeadMagnet = uxType === 'lead-magnet';
  const isTipJar = uxType === 'tip-jar';
  const isSubscription = formData.product_type === 'subscription';
  const showPaidPriceInput = !isSubscription && !isLeadMagnet && !isTipJar;

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

      {/* A bundle cannot itself be a subscription — hide the subscription config. */}
      {!formData.is_bundle && (
        <SubscriptionSection formData={formData} setFormData={setFormData} t={t} />
      )}

      {showPaidPriceInput && (
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

      {isTipJar && (
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
          mode="tip-jar"
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
