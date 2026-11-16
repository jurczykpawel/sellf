'use client';

import React from 'react';
import { AccessSection, BundleItemsSection, ContentDeliverySection, LicenseSection } from '../../sections';
import { FormGroup } from '../FormSection';
import type { ProductFormData, TranslationFunction, UrlValidation } from '../../types';
import type { Product } from '@/types';

interface DeliveryPanelProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
  urlValidation: Record<number, UrlValidation>;
  setUrlValidation: React.Dispatch<React.SetStateAction<Record<number, UrlValidation>>>;
  validateContentItemUrl: (url: string, type: 'video_embed' | 'download_link') => UrlValidation;
  /** Product list used by the bundle component picker (bundle mode only). */
  products: Product[];
  /** Id of the product being edited — excluded from the bundle picker. */
  currentProductId?: string;
  hasLicenseIssuance?: boolean;
  fieldErrors?: Record<string, string>;
  setFieldErrors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

/** What the buyer gets after purchase: bundle items, content or redirect, access period, license key. */
export const DeliveryPanel: React.FC<DeliveryPanelProps> = ({
  formData, setFormData, t, urlValidation, setUrlValidation, validateContentItemUrl,
  products, currentProductId, hasLicenseIssuance, fieldErrors, setFieldErrors,
}) => {
  const isTipJar = formData.checkout_template === 'tip-jar';
  return (
    <>
      {/* A bundle may still carry its own bonus content via the content section below. */}
      {formData.is_bundle && (
        <BundleItemsSection formData={formData} setFormData={setFormData} t={t} products={products} currentProductId={currentProductId} />
      )}
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
      <FormGroup title={t('autoGrantAccessSettings')}>
        <AccessSection formData={formData} setFormData={setFormData} t={t} />
      </FormGroup>
      <FormGroup title={t('license.sectionTitle')}>
        <LicenseSection formData={formData} setFormData={setFormData} t={t} hasLicenseIssuance={hasLicenseIssuance} fieldErrors={fieldErrors} setFieldErrors={setFieldErrors} />
      </FormGroup>
    </>
  );
};
