'use client';

import React from 'react';
import { CheckoutProfileSection } from '../../sections/CheckoutProfileSection';
import { CustomCheckoutFieldsSection, LeadConsentSection } from '../../sections';
import type { ProductFormData, TranslationFunction } from '../../types';

interface CartPanelProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
}

/** What the buyer fills in before paying: buyer and seats, extra fields, lead-form consent. */
export const CartPanel: React.FC<CartPanelProps> = ({ formData, setFormData, t }) => (
  <>
    <CheckoutProfileSection formData={formData} setFormData={setFormData} />
    <CustomCheckoutFieldsSection formData={formData} setFormData={setFormData} />
    <LeadConsentSection formData={formData} setFormData={setFormData} t={t} />
  </>
);
