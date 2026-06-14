'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ProductFormData } from '../types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';
import {
  createPredefinedCustomField,
  PREDEFINED_CUSTOM_FIELDS,
  validateCustomFieldDefinitions,
  CUSTOM_FIELD_MAX_PER_PRODUCT,
  CUSTOM_FIELD_MAX_VALUE_LENGTH,
  type CustomFieldDefinition,
  type CustomFieldType,
} from '@/lib/validations/custom-checkout-fields';

interface Props {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
}

function asLabelString(label: CustomFieldDefinition['label'], locale: string): string {
  if (typeof label === 'string') return label;
  return locale.startsWith('pl') ? label.pl : label.en;
}

export function CustomCheckoutFieldsSection({ formData, setFormData }: Props) {
  const t = useTranslations('productForm.customFields');
  const locale = useLocale();

  const validation = validateCustomFieldDefinitions(formData.custom_checkout_fields);
  const fieldErrors = validation.ok ? {} : validation.errors;
  const hasLicenseDomain = formData.custom_checkout_fields.some(
    (field) => field.id === PREDEFINED_CUSTOM_FIELDS.license_domain.id,
  );

  const addField = () => {
    if (formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT) return;
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: [
        ...prev.custom_checkout_fields,
        {
          id: `field_${prev.custom_checkout_fields.length + 1}`,
          type: 'text',
          label: '',
          required: false,
          max_length: 200,
        },
      ],
    }));
  };

  const addLicenseDomain = () => {
    if (hasLicenseDomain || formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT) return;
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: [
        ...prev.custom_checkout_fields,
        createPredefinedCustomField('license_domain'),
      ],
    }));
  };

  const updateField = (index: number, patch: Partial<CustomFieldDefinition>) => {
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: prev.custom_checkout_fields.map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      ),
    }));
  };

  const removeField = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: prev.custom_checkout_fields.filter((_, i) => i !== index),
    }));
  };

  const resetToDefaults = () => {
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields:
        prev.checkout_template === 'tip-jar' ? getTipJarDefaultCustomFields() : [],
    }));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-sf-muted">{t('automaticEmailHint')}</p>
      <header className="flex items-center justify-between">
        <p className="text-xs text-sf-muted">{t('helpText')}</p>
        <div className="flex items-center gap-2">
          {formData.checkout_template === 'tip-jar' && (
            <button
              type="button"
              onClick={resetToDefaults}
              className="text-xs text-sf-muted hover:text-sf-accent underline"
            >
              {t('resetDefaults')}
            </button>
          )}
          <button
            type="button"
            onClick={addField}
            disabled={formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT}
            className="px-3 py-1.5 text-sm font-medium bg-sf-accent-bg hover:bg-sf-accent-hover text-white rounded-full disabled:bg-sf-muted/30 disabled:cursor-not-allowed"
          >
            {t('addButton')}
          </button>
          <button
            type="button"
            onClick={addLicenseDomain}
            disabled={hasLicenseDomain || formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT}
            className="px-3 py-1.5 text-sm font-medium border border-sf-accent text-sf-accent rounded-full disabled:text-sf-muted disabled:border-sf-border disabled:cursor-not-allowed"
          >
            {t('addLicenseDomain')}
          </button>
        </div>
      </header>

      {formData.custom_checkout_fields.length === 0 ? (
        <p className="text-sm text-sf-muted py-4 text-center">{t('emptyState')}</p>
      ) : (
        <ul className="space-y-3">
          {formData.custom_checkout_fields.map((field, idx) => {
            const labelString = asLabelString(field.label, locale);
            const error = fieldErrors[String(idx)];
            const isLicenseDomain = field.id === PREDEFINED_CUSTOM_FIELDS.license_domain.id;
            return (
              <li
                key={idx}
                className="bg-sf-base border border-sf-border rounded-lg p-3 space-y-2"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                  <input
                    aria-label={t('fieldId')}
                    placeholder={t('fieldId')}
                    value={field.id}
                    disabled={isLicenseDomain}
                    onChange={(e) => updateField(idx, { id: e.target.value })}
                    className="lg:col-span-3 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  />
                  {isLicenseDomain ? (
                    <div className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-raised text-sf-body">
                      {t('fieldType.domain')}
                    </div>
                  ) : (
                    <select
                      aria-label={t('fieldType.label')}
                      value={field.type}
                      onChange={(e) =>
                        updateField(idx, { type: e.target.value as CustomFieldType })
                      }
                      className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                    >
                      <option value="text">{t('fieldType.text')}</option>
                      <option value="textarea">{t('fieldType.textarea')}</option>
                      <option value="email">{t('fieldType.email')}</option>
                    </select>
                  )}
                  <input
                    aria-label={t('fieldLabel')}
                    placeholder={t('fieldLabel')}
                    value={labelString}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    className="lg:col-span-4 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  />
                  <input
                    aria-label={t('maxLength')}
                    type="number"
                    min={1}
                    max={CUSTOM_FIELD_MAX_VALUE_LENGTH}
                    value={field.max_length}
                    onChange={(e) =>
                      updateField(idx, {
                        max_length: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  />
                  <label className="lg:col-span-1 flex items-center gap-1 text-xs text-sf-body">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(idx, { required: e.target.checked })}
                    />
                    {t('required')}
                  </label>
                </div>
                {error && <p className="text-xs text-sf-danger">{error}</p>}
                {isLicenseDomain && <p className="text-xs text-sf-muted">{t('licenseDomainHint')}</p>}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeField(idx)}
                    className="text-xs text-sf-danger hover:underline"
                  >
                    {t('removeButton')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
