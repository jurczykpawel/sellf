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

interface GroupProps {
  letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  title: string;
  children: React.ReactNode;
}

function StepGroup({ letter, title, children }: GroupProps) {
  return (
    <section data-step3-group={letter} className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-sf-muted border-b border-sf-border pb-2">
        <span className="text-sf-accent mr-2">{letter}.</span>
        {title}
      </h3>
      <div className="space-y-6">{children}</div>
    </section>
  );
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
    <div className="space-y-8">
      <StepGroup letter="A" title={t('step3.conversion')}>
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
      </StepGroup>

      <StepGroup letter="B" title={t('step3.formFields')}>
        <CustomCheckoutFieldsSection formData={formData} setFormData={setFormData} />
      </StepGroup>

      <StepGroup letter="C" title={t('step3.availability')}>
        <div>
          <h4 className="text-sm font-medium text-sf-heading mb-2">
            {t('availabilityAndWaitlist')}
          </h4>
          <AvailabilitySection
            formData={formData}
            setFormData={setFormData}
            t={t}
            hasWaitlistWebhook={hasWaitlistWebhook}
          />
        </div>
        <div>
          <h4 className="text-sm font-medium text-sf-heading mb-2">
            {t('autoGrantAccessSettings')}
          </h4>
          <AccessSection formData={formData} setFormData={setFormData} t={t} />
        </div>
      </StepGroup>

      <StepGroup letter="D" title={t('step3.postPurchase')}>
        <EmbedSection formData={formData} setFormData={setFormData} t={t} />
      </StepGroup>

      <StepGroup letter="E" title={t('step3.refunds')}>
        <RefundSection formData={formData} setFormData={setFormData} t={t} />
      </StepGroup>

      <StepGroup letter="F" title={t('step3.advanced')}>
        <AdvancedSection
          formData={formData}
          setFormData={setFormData}
          t={t}
          omnibusEnabled={omnibusEnabled}
        />
      </StepGroup>
    </div>
  );
};
