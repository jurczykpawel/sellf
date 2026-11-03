'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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

type ErrorTranslator = (key: string, values?: Record<string, string>) => string;

/** Maps a validator code (`@see lib/validations/custom-checkout-fields.ts`) to buyer-facing text. */
export function customFieldErrorMessage(code: string, t: ErrorTranslator): string {
  const [name, argument] = code.split(':');
  switch (name) {
    case 'required': return t('required');
    case 'too_long': return t('tooLong', { max: argument ?? '' });
    case 'invalid_email': return t('invalidEmail');
    case 'invalid_domain': return t('invalidDomain');
    case 'unknown_field': return t('unknownField');
    default: return t('invalidValue');
  }
}

function resolveLabel(label: CustomFieldLabel, locale: string): string {
  if (typeof label === 'string') return label;
  return locale.startsWith('pl') ? label.pl : label.en;
}

// Buyer-facing renderer for product.custom_checkout_fields. Pure controlled
// component — parent owns state, this is "view + onChange". It shows the error
// codes the parent passes (client validation or a server `fieldErrors` reply)
// as localized text next to the field and moves focus to the first one.
export default function CustomCheckoutFieldsForm({
  fields,
  values,
  onChange,
  errors,
  disabled,
}: CustomCheckoutFieldsFormProps) {
  const locale = useLocale();
  const t = useTranslations('checkout.customFieldErrors');
  const formId = useId();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors && Object.keys(errors).length > 0) {
      container.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus({ preventScroll: false });
    }
  }, [errors]);

  const labeled = useMemo(
    () => fields.map((f) => ({ ...f, _label: resolveLabel(f.label, locale) })),
    [fields, locale],
  );

  if (fields.length === 0) return null;

  const update = (id: string, value: string) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <div ref={container} className="space-y-4">
      {errors?._ && <p role="alert" className="text-sm text-sf-danger">{customFieldErrorMessage(errors._, t)}</p>}
      {labeled.map((field) => {
        const inputId = `${formId}-${field.id}`;
        const value = values[field.id] ?? '';
        const error = errors?.[field.id] ? customFieldErrorMessage(errors[field.id], t) : undefined;
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
                aria-required={field.required}
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
                aria-required={field.required}
                disabled={disabled}
                placeholder={field.placeholder}
                aria-invalid={!!error}
                aria-describedby={helpId}
                className="w-full p-3 border border-sf-border rounded-lg bg-sf-input text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:opacity-60"
              />
            )}

            <div className="flex items-center justify-between mt-1 text-xs">
              {error ? (
                <p id={helpId} role="alert" className="text-sf-danger">
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
