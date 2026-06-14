'use client';

import { useId, useMemo } from 'react';
import { useLocale } from 'next-intl';
import type {
  CustomFieldDefinition,
  CustomFieldLabel,
  CustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';

interface CustomCheckoutFieldsFormProps {
  fields: CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (next: CustomFieldValues) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

function resolveLabel(label: CustomFieldLabel, locale: string): string {
  if (typeof label === 'string') return label;
  return locale.startsWith('pl') ? label.pl : label.en;
}

// Buyer-facing renderer for product.custom_checkout_fields. Pure controlled
// component — parent owns state, this is "view + onChange". Walidacja
// strukturalna jest server-side; tu pokazujemy tylko inline errors podane
// przez rodzica (np. po nieudanym POST do /api/create-payment-intent).
export default function CustomCheckoutFieldsForm({
  fields,
  values,
  onChange,
  errors,
  disabled,
}: CustomCheckoutFieldsFormProps) {
  const locale = useLocale();
  const formId = useId();

  const labeled = useMemo(
    () => fields.map((f) => ({ ...f, _label: resolveLabel(f.label, locale) })),
    [fields, locale],
  );

  if (fields.length === 0) return null;

  const update = (id: string, value: string) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <div className="space-y-4">
      {labeled.map((field) => {
        const inputId = `${formId}-${field.id}`;
        const value = values[field.id] ?? '';
        const error = errors?.[field.id];
        const helpId = error ? `${inputId}-error` : undefined;

        return (
          <div key={field.id}>
            <label
              htmlFor={inputId}
              className="block text-sm font-medium text-sf-body mb-2"
            >
              {field._label}
              {field.required && <span className="text-sf-danger ml-1">*</span>}
            </label>

            {field.type === 'textarea' ? (
              <textarea
                id={inputId}
                value={value}
                onChange={(e) => update(field.id, e.target.value)}
                maxLength={field.max_length}
                required={field.required}
                disabled={disabled}
                placeholder={field.placeholder}
                aria-invalid={!!error}
                aria-describedby={helpId}
                className="w-full p-3 min-h-[88px] border border-sf-border rounded-lg bg-sf-input text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:opacity-60"
              />
            ) : (
              <input
                id={inputId}
                type={field.type === 'email' ? 'email' : 'text'}
                inputMode={field.type === 'domain' ? 'url' : undefined}
                value={value}
                onChange={(e) => update(field.id, e.target.value)}
                maxLength={field.max_length}
                required={field.required}
                disabled={disabled}
                placeholder={field.placeholder}
                aria-invalid={!!error}
                aria-describedby={helpId}
                className="w-full p-3 border border-sf-border rounded-lg bg-sf-input text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:opacity-60"
              />
            )}

            <div className="flex items-center justify-between mt-1 text-xs">
              {error ? (
                <p id={helpId} className="text-sf-danger">
                  {error}
                </p>
              ) : (
                <span className="text-sf-muted" aria-hidden="true">
                  &nbsp;
                </span>
              )}
              <span className="text-sf-muted tabular-nums">
                {value.length}/{field.max_length}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
