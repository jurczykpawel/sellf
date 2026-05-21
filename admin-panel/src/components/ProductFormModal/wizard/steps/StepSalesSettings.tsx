'use client';

import React, { useState } from 'react';
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

type GroupLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

interface GroupProps {
  letter: GroupLetter;
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function StepGroup({ letter, title, defaultExpanded = false, children }: GroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section data-step3-group={letter} className="border border-sf-border rounded-lg bg-sf-raised overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sf-hover transition-colors"
      >
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className="w-7 h-7 flex items-center justify-center rounded-full bg-sf-accent-soft text-sf-accent text-sm font-semibold"
          >
            {letter}
          </span>
          <span className="text-sm font-semibold text-sf-heading">{title}</span>
        </span>
        <svg
          className={`w-4 h-4 text-sf-muted flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pt-4 pb-5 border-t border-sf-border bg-sf-base space-y-6">
          {children}
        </div>
      )}
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
    <div className="space-y-3">
      <StepGroup letter="A" title={t('step3.conversion')} defaultExpanded>
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
