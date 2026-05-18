'use client';

import React from 'react';
import {
  SalePriceSection,
  AvailabilitySection,
  AccessSection,
  EmbedSection,
  PostPurchaseSection,
  RefundSection,
  AdvancedSection,
  BadgeGeneratorSection,
} from '../../sections';
import type { ProductFormData, TranslationFunction, OtoState } from '../../types';
import type { Product } from '@/types';

interface StepSalesSettingsProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
  salePriceDisplayValue: string;
  setSalePriceDisplayValue: (value: string) => void;
  omnibusEnabled: boolean;
  hasWaitlistWebhook: boolean | null;
  products: Product[];
  loadingProducts: boolean;
  currentProductId?: string;
  oto: OtoState;
  setOto: React.Dispatch<React.SetStateAction<OtoState>>;
}

export const StepSalesSettings: React.FC<StepSalesSettingsProps> = ({
  formData,
  setFormData,
  t,
  salePriceDisplayValue,
  setSalePriceDisplayValue,
  omnibusEnabled,
  hasWaitlistWebhook,
  products,
  loadingProducts,
  currentProductId,
  oto,
  setOto,
}) => {
  return (
    <div className="space-y-6">
      <SalePriceSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        salePriceDisplayValue={salePriceDisplayValue}
        setSalePriceDisplayValue={setSalePriceDisplayValue}
        omnibusEnabled={omnibusEnabled}
      />

      <AvailabilitySection
        formData={formData}
        setFormData={setFormData}
        t={t}
        hasWaitlistWebhook={hasWaitlistWebhook}
      />

      <AccessSection
        formData={formData}
        setFormData={setFormData}
        t={t}
      />

      <EmbedSection
        formData={formData}
        setFormData={setFormData}
        t={t}
      />

      <PostPurchaseSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        products={products}
        loadingProducts={loadingProducts}
        currentProductId={currentProductId}
        oto={oto}
        setOto={setOto}
      />

      <RefundSection
        formData={formData}
        setFormData={setFormData}
        t={t}
      />

      <AdvancedSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        omnibusEnabled={omnibusEnabled}
      />

      <BadgeGeneratorSection formData={formData} />
    </div>
  );
};
