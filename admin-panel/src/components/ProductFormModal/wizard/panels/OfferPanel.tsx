'use client';

import React from 'react';
import { MarketingSection } from '../../sections/MarketingSection';
import { CategoriesSection, DescriptionSection, PricingSection, TagsSection } from '../../sections';
import type { ProductFormData, TranslationFunction } from '../../types';
import type { Category } from '@/lib/actions/categories';
import type { Tag } from '@/lib/actions/tags';

interface OfferPanelProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
  onIconSelect: (icon: string) => void;
  allCategories: Category[];
  loadingCategories: boolean;
  allTags: Tag[];
  loadingTags: boolean;
  fieldErrors?: Record<string, string>;
  setFieldErrors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

/** Description and look of the sales page: copy, marketing details, media, categories, tags. */
export const OfferPanel: React.FC<OfferPanelProps> = ({
  formData, setFormData, t, onIconSelect, allCategories, loadingCategories, allTags, loadingTags, fieldErrors, setFieldErrors,
}) => (
  <>
    <DescriptionSection formData={formData} setFormData={setFormData} t={t} fieldErrors={fieldErrors} setFieldErrors={setFieldErrors} />
    <MarketingSection formData={formData} setFormData={setFormData} t={t} fieldErrors={fieldErrors} />
    <PricingSection formData={formData} setFormData={setFormData} t={t} onIconSelect={onIconSelect} />
    <CategoriesSection formData={formData} setFormData={setFormData} t={t} allCategories={allCategories} loadingCategories={loadingCategories} />
    <TagsSection formData={formData} setFormData={setFormData} t={t} allTags={allTags} loadingTags={loadingTags} />
  </>
);
