'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { ProductFormData } from '../types';
import {
  applyProductTypeDefaults,
  inferProductTypeFromForm,
  UX_PRODUCT_TYPES_DISABLED,
  type UxProductType,
} from '@/lib/product-defaults';

interface ProductTypeRadioProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  isEditing?: boolean;
}

const TYPE_ICONS: Record<UxProductType, string> = {
  standard: '📦',
  subscription: '🔄',
  installments: '💳',
  'tip-jar': '💰',
  'lead-magnet': '🎁',
};

const ALL_TYPES: ReadonlyArray<UxProductType> = [
  'standard',
  'subscription',
  'installments',
  'tip-jar',
  'lead-magnet',
];

export function ProductTypeRadio({ formData, setFormData, isEditing }: ProductTypeRadioProps) {
  const t = useTranslations('productForm.productType');
  const current = inferProductTypeFromForm(formData);

  const handleSelect = (type: UxProductType) => {
    if (UX_PRODUCT_TYPES_DISABLED.includes(type)) return;
    if (type === current) return;
    setFormData((prev) => applyProductTypeDefaults(prev, type));
  };

  if (isEditing) {
    return (
      <p className="text-xs text-sf-muted">
        {t('lockedInEdit', { type: t(`options.${current}.name`) })}
      </p>
    );
  }

  return (
    <fieldset className="space-y-2" aria-label={t('legend')}>
      <legend className="block text-sm font-medium text-sf-body mb-2">{t('legend')}</legend>
      <div role="radiogroup" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {ALL_TYPES.map((type) => {
          const disabled = UX_PRODUCT_TYPES_DISABLED.includes(type);
          const selected = !disabled && current === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              data-product-type={type}
              onClick={() => handleSelect(type)}
              className={`flex flex-col items-center gap-1 p-3 border-2 rounded-lg text-left text-xs transition ${
                selected
                  ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                  : disabled
                    ? 'border-sf-border bg-sf-base/50 text-sf-muted cursor-not-allowed opacity-60'
                    : 'border-sf-border hover:border-sf-accent/50 text-sf-body'
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {TYPE_ICONS[type]}
              </span>
              <span className="font-medium text-sf-heading text-center">
                {t(`options.${type}.name`)}
              </span>
              <span className="text-[10px] text-sf-muted text-center leading-tight">
                {disabled ? t('comingSoon') : t(`options.${type}.tagline`)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-sf-muted">{t(`options.${current}.help`)}</p>
    </fieldset>
  );
}
