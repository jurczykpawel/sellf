'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import {
  SalePriceSection,
  AvailabilitySection,
  AccessSection,
  EmbedSection,
  PostPurchaseSection,
  RefundSection,
  AdvancedSection,
  BadgeGeneratorSection,
  CustomCheckoutFieldsSection,
  FeaturedToggle,
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
  const isTipJar = formData.checkout_template === 'tip-jar';

  return (
    <div className="space-y-4">
      {/* A. Konwersja */}
      <ModalSection title={t('step3.conversion')} collapsible defaultExpanded>
        <div className="space-y-6">
          <SalePriceSection
            formData={formData}
            setFormData={setFormData}
            t={t}
            salePriceDisplayValue={salePriceDisplayValue}
            setSalePriceDisplayValue={setSalePriceDisplayValue}
            omnibusEnabled={omnibusEnabled}
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
          <FeaturedToggle formData={formData} setFormData={setFormData} t={t} />
          {isTipJar && <BadgeGeneratorSection formData={formData} />}
        </div>
      </ModalSection>

      {/* B. Pola formularza */}
      <ModalSection title={t('step3.formFields')} collapsible>
        <CustomCheckoutFieldsSection formData={formData} setFormData={setFormData} />
      </ModalSection>

      {/* C. Dostępność i dostęp */}
      <ModalSection title={t('step3.availability')} collapsible>
        <div className="space-y-6">
          <AvailabilitySection
            formData={formData}
            setFormData={setFormData}
            t={t}
            hasWaitlistWebhook={hasWaitlistWebhook}
          />
          <AccessSection formData={formData} setFormData={setFormData} t={t} />
        </div>
      </ModalSection>

      {/* D. Po zakupie (embed) */}
      <ModalSection title={t('step3.postPurchase')} collapsible>
        <EmbedSection formData={formData} setFormData={setFormData} t={t} />
      </ModalSection>

      {/* E. Zwroty */}
      <ModalSection title={t('step3.refunds')} collapsible>
        <RefundSection formData={formData} setFormData={setFormData} t={t} />
      </ModalSection>

      {/* F. Zaawansowane */}
      <ModalSection title={t('step3.advanced')} collapsible>
        <AdvancedSection
          formData={formData}
          setFormData={setFormData}
          t={t}
          omnibusEnabled={omnibusEnabled}
        />
      </ModalSection>
    </div>
  );
};
