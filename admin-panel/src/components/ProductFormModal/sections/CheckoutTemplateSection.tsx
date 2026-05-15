'use client';

import React, { useMemo, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ProductFormData } from '../types';
import { getAllTemplates } from '@/lib/checkout-templates/registry';
import type { CheckoutTemplateSlug } from '@/lib/checkout-templates/types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';
import {
  validateCustomFieldDefinitions,
  CUSTOM_FIELD_MAX_PER_PRODUCT,
  CUSTOM_FIELD_MAX_VALUE_LENGTH,
  type CustomFieldDefinition,
  type CustomFieldType,
} from '@/lib/validations/custom-checkout-fields';

interface CheckoutTemplateSectionProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  onRequestStepChange?: (step: number) => void;
}

function asLabelString(label: CustomFieldDefinition['label'], locale: string): string {
  if (typeof label === 'string') return label;
  return locale.startsWith('pl') ? label.pl : label.en;
}

// Phase 6 — admin UI for checkout template selection + custom field editor.
// Lives in Step 5 (Sales & Settings). Picking `tip-jar` auto-seeds the
// default field list (just `message` for now) and forces allow_custom_price.
export default function CheckoutTemplateSection({
  formData,
  setFormData,
  onRequestStepChange,
}: CheckoutTemplateSectionProps) {
  const t = useTranslations('productForm.checkoutTemplate');
  const tFields = useTranslations('productForm.customFields');
  const templates = useMemo(() => getAllTemplates(), []);
  const [pendingTipJar, setPendingTipJar] = useState(false);

  const applyTemplate = useCallback(
    (slug: CheckoutTemplateSlug) => {
      setFormData((prev) => {
        const shouldSeed = slug === 'tip-jar' && prev.custom_checkout_fields.length === 0;
        return {
          ...prev,
          checkout_template: slug,
          custom_checkout_fields: shouldSeed
            ? getTipJarDefaultCustomFields()
            : prev.custom_checkout_fields,
        };
      });
    },
    [setFormData],
  );

  const handleTemplateChange = useCallback(
    (slug: CheckoutTemplateSlug) => {
      if (slug === 'tip-jar' && !formData.allow_custom_price) {
        setPendingTipJar(true);
        return;
      }
      applyTemplate(slug);
    },
    [formData.allow_custom_price, applyTemplate],
  );

  const validation = validateCustomFieldDefinitions(formData.custom_checkout_fields);
  const fieldErrors = validation.ok ? {} : validation.errors;

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
    <section className="bg-sf-raised border border-sf-border rounded-2xl p-5 space-y-5">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-sf-heading">{t('label')}</h2>
        <p className="text-xs text-sf-muted">{t('helpText')}</p>
      </header>

      <div>
        <label htmlFor="checkout-template-select" className="block text-sm font-medium text-sf-body mb-2">
          {t('selectLabel')}
        </label>
        <select
          id="checkout-template-select"
          value={formData.checkout_template}
          onChange={(e) => handleTemplateChange(e.target.value as CheckoutTemplateSlug)}
          className="w-full p-3 border border-sf-border rounded-lg bg-sf-input text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent"
        >
          {templates.map((tpl) => (
            <option key={tpl.slug} value={tpl.slug}>
              {t(`options.${tpl.slug === 'tip-jar' ? 'tipJar' : tpl.slug}.name`)}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-sf-muted">
          {t(
            `options.${formData.checkout_template === 'tip-jar' ? 'tipJar' : formData.checkout_template}.description`,
          )}
        </p>
        {formData.checkout_template === 'tip-jar' && (
          <p className="mt-2 text-xs text-sf-warning">{t('tipJarRequiresPwyw')}</p>
        )}
        {pendingTipJar && (
          <div className="mt-3 p-3 bg-sf-warning-soft border border-sf-warning rounded-lg space-y-2">
            <p className="text-sm text-sf-warning">
              {t('tipJarPwywPrompt', { defaultValue: 'Tip jar wymaga włączonego PWYW (Pay What You Want). Czy chcesz przejść do kroku Pricing i włączyć tę opcję?' })}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPendingTipJar(false)}
                className="px-3 py-1.5 text-sm font-medium text-sf-body bg-sf-raised border border-sf-border rounded-full hover:bg-sf-deep"
              >
                {t('tipJarPwywCancel', { defaultValue: 'Anuluj' })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingTipJar(false);
                  onRequestStepChange?.(2);
                }}
                className="px-3 py-1.5 text-sm font-medium text-white bg-sf-accent-bg rounded-full hover:bg-sf-accent-hover"
              >
                {t('tipJarPwywGoToPricing', { defaultValue: 'Przejdź do Pricing' })}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-sf-border pt-4">
        <header className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-sf-heading">{tFields('label')}</h3>
            <p className="text-xs text-sf-muted">{tFields('helpText')}</p>
          </div>
          <div className="flex items-center gap-2">
            {formData.checkout_template === 'tip-jar' && (
              <button
                type="button"
                onClick={resetToDefaults}
                className="text-xs text-sf-muted hover:text-sf-accent underline"
              >
                {tFields('resetDefaults')}
              </button>
            )}
            <button
              type="button"
              onClick={addField}
              disabled={formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT}
              className="px-3 py-1.5 text-sm font-medium bg-sf-accent-bg hover:bg-sf-accent-hover text-white rounded-full disabled:bg-sf-muted/30 disabled:cursor-not-allowed"
            >
              {tFields('addButton')}
            </button>
          </div>
        </header>

        {formData.custom_checkout_fields.length === 0 ? (
          <p className="text-sm text-sf-muted py-4 text-center">{tFields('emptyState')}</p>
        ) : (
          <ul className="space-y-3">
            {formData.custom_checkout_fields.map((field, idx) => {
              const labelString = asLabelString(field.label, 'pl');
              const error = fieldErrors[String(idx)];
              return (
                <li key={idx} className="bg-sf-base border border-sf-border rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                    <input
                      aria-label={tFields('fieldId')}
                      placeholder={tFields('fieldId')}
                      value={field.id}
                      onChange={(e) => updateField(idx, { id: e.target.value })}
                      className="lg:col-span-3 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                    />
                    <select
                      aria-label={tFields('fieldType.label')}
                      value={field.type}
                      onChange={(e) => updateField(idx, { type: e.target.value as CustomFieldType })}
                      className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                    >
                      <option value="text">{tFields('fieldType.text')}</option>
                      <option value="textarea">{tFields('fieldType.textarea')}</option>
                      <option value="email">{tFields('fieldType.email')}</option>
                    </select>
                    <input
                      aria-label={tFields('fieldLabel')}
                      placeholder={tFields('fieldLabel')}
                      value={labelString}
                      onChange={(e) => updateField(idx, { label: e.target.value })}
                      className="lg:col-span-4 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                    />
                    <input
                      aria-label={tFields('maxLength')}
                      type="number"
                      min={1}
                      max={CUSTOM_FIELD_MAX_VALUE_LENGTH}
                      value={field.max_length}
                      onChange={(e) =>
                        updateField(idx, { max_length: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                    />
                    <label className="lg:col-span-1 flex items-center gap-1 text-xs text-sf-body">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(idx, { required: e.target.checked })}
                      />
                      {tFields('required')}
                    </label>
                  </div>
                  {error && <p className="text-xs text-sf-danger">{error}</p>}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeField(idx)}
                      className="text-xs text-sf-danger hover:underline"
                    >
                      {tFields('removeButton')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
