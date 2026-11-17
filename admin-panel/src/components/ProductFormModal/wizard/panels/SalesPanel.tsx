'use client';

import React from 'react';
import { AffiliateRuleEditor } from '@/components/affiliates/products/Settings';
import { CocreatorEditor } from '@/components/affiliates/products/CocreatorSettings';
import {
  AdvancedSection,
  AvailabilitySection,
  BadgeGeneratorSection,
  EmbedSection,
  FeaturedToggle,
  PostPurchaseSection,
  RefundSection,
  SalePriceSection,
} from '../../sections';
import { FormGroup } from '../FormSection';
import type { OtoState, ProductFormData, TranslationFunction } from '../../types';
import type { Product } from '@/types';

interface SalesPanelProps {
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

/** When and where the product sells: promotion, availability, visibility, after purchase, refunds, embed, commission. */
export const SalesPanel: React.FC<SalesPanelProps> = ({
  formData, setFormData, t, salePriceDisplayValue, setSalePriceDisplayValue, omnibusEnabled,
  hasWaitlistWebhook, products, loadingProducts, currentProductId, oto, setOto,
}) => {
  const isTipJar = formData.checkout_template === 'tip-jar';
  return (
    <>
      <SalePriceSection
        formData={formData}
        setFormData={setFormData}
        t={t}
        salePriceDisplayValue={salePriceDisplayValue}
        setSalePriceDisplayValue={setSalePriceDisplayValue}
        omnibusEnabled={omnibusEnabled}
      />
      <FormGroup title={t('availabilityAndWaitlist')}>
        <AvailabilitySection formData={formData} setFormData={setFormData} t={t} hasWaitlistWebhook={hasWaitlistWebhook} />
      </FormGroup>
      <FormGroup title={t('sections.groups.visibility')}>
        <AdvancedSection formData={formData} setFormData={setFormData} t={t} omnibusEnabled={omnibusEnabled} />
        <FeaturedToggle formData={formData} setFormData={setFormData} t={t} />
      </FormGroup>
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
      <FormGroup title={t('sections.groups.refunds')}>
        <RefundSection formData={formData} setFormData={setFormData} t={t} />
      </FormGroup>
      <FormGroup title={t('sections.groups.embed')}>
        <EmbedSection formData={formData} setFormData={setFormData} t={t} />
        {isTipJar && <BadgeGeneratorSection formData={formData} />}
      </FormGroup>
      {currentProductId && <AffiliateRuleEditor key={currentProductId} productId={currentProductId} productType={formData.product_type}
        isRefundable={formData.is_refundable} refundPeriodDays={formData.refund_period_days} />}
      {currentProductId && <CocreatorEditor key={`cocreator-${currentProductId}`} productId={currentProductId} productType={formData.product_type} />}
    </>
  );
};
