'use client';

/** Seller-authored editorial metadata. @see spec/contracts/product-marketing-fields.md */
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { marketingFieldsSchema, productFormatSchema, resolveMarketingCopy } from '@/lib/validations/product-marketing';
import { ModalSection } from '@/components/ui/Modal';
import type { ProductMarketingCopy, ProductMarketingFields } from '@/lib/validations/product-marketing';
import type { SectionProps } from '@/components/ProductFormModal/types';

interface MarketingSectionProps extends SectionProps {
  fieldErrors?: Record<string, string>;
}
const emptyCopy = (): ProductMarketingCopy => ({ result: null, tools: [], requirements: [] });
const controlClass = 'w-full min-w-0 border border-sf-border bg-sf-input text-sf-heading px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sf-accent';

export function MarketingSection({ formData, setFormData, t, fieldErrors }: MarketingSectionProps) {
  const locale = useLocale();
  const [editingLocale, setEditingLocale] = useState<'en' | 'pl'>(locale === 'pl' ? 'pl' : 'en');
  const id = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const focusTarget = useRef<string | null>(null);
  const fields = formData.marketing_fields;
  const resolved = resolveMarketingCopy(fields, editingLocale);
  const copy = fields[editingLocale];
  const valid = marketingFieldsSchema.safeParse(fields).success;
  const describedBy = `${id}-help${valid ? '' : ` ${id}-error`}`;
  useEffect(() => {
    if (fieldErrors?.marketing_fields) errorRef.current?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (focusTarget.current) {
      document.getElementById(focusTarget.current)?.focus();
      focusTarget.current = null;
    }
  }, [fields]);

  function update(fields: ProductMarketingFields): void {
    setFormData(previous => ({ ...previous, marketing_fields: fields }));
  }
  function updateCopy(next: ProductMarketingCopy): void {
    update({ ...fields, [editingLocale]: next });
  }

  return (
    <ModalSection title={t('marketing.title')}>
      <div className="space-y-4 min-w-0" data-testid="product-marketing">
        <p id={`${id}-help`} className="text-sm text-sf-muted">{t('marketing.help')}</p>
        {!valid && <p id={`${id}-error`} ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-sf-danger focus:ring-2 focus:ring-sf-accent">{t('marketing.invalid')}</p>}
        <div>
          <label htmlFor={`${id}-format`} className="block text-sm text-sf-body">{t('marketing.format')}</label>
          <select id={`${id}-format`} className={controlClass} value={fields.format ?? ''} aria-describedby={describedBy}
            onChange={event => update({ ...fields, format: productFormatSchema.safeParse(event.target.value).data ?? null })}>
            <option value="">{t('marketing.noFormat')}</option>
            {productFormatSchema.options.map(format => <option key={format} value={format}>{t(`marketing.formats.${format}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-source`} className="block text-sm text-sf-body">{t('marketing.sourceLocale')}</label>
          <select id={`${id}-source`} value={fields.sourceLocale} className={controlClass} aria-describedby={describedBy}
            onChange={event => {
              const sourceLocale = event.target.value === 'pl' ? 'pl' : 'en';
              update({ ...fields, [sourceLocale]: fields[sourceLocale] ?? emptyCopy(), sourceLocale } as ProductMarketingFields);
            }}>
            <option value="en">English</option><option value="pl">Polski</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-locale`} className="block text-sm text-sf-body">{t('marketing.locale')}</label>
          <select id={`${id}-locale`} className={controlClass} value={editingLocale}
            onChange={event => setEditingLocale(event.target.value === 'pl' ? 'pl' : 'en')}>
            <option value="en">English</option><option value="pl">Polski</option>
          </select>
        </div>
        {resolved.fallback && (
          <div role="status" className="text-sm text-sf-body break-words">
            <p>{t('marketing.fallback', { locale: resolved.locale })}</p>
            {resolved.copy.result !== null && <p lang={resolved.locale}>{resolved.copy.result}</p>}
            {(['tools', 'requirements'] as const).map(key => resolved.copy[key].length > 0 && (
              <p key={key} lang={resolved.locale}>{t(`marketing.${key}`)}: {resolved.copy[key].join(', ')}</p>
            ))}
            <button type="button" className="underline focus:ring-2 focus:ring-sf-accent" onClick={() => { focusTarget.current = `${id}-result`; updateCopy(emptyCopy()); }}>{t('marketing.addTranslation')}</button>
          </div>
        )}
        {copy && <>
          <div>
            <label htmlFor={`${id}-result`} className="block text-sm text-sf-body">{t('marketing.result')}</label>
            <textarea id={`${id}-result`} lang={editingLocale} className={controlClass} rows={3} value={copy.result ?? ''} aria-describedby={describedBy} aria-invalid={!valid}
              onChange={event => updateCopy({ ...copy, result: event.target.value === '' ? null : event.target.value })} />
          </div>
          {(['tools', 'requirements'] as const).map(key => (
            <fieldset key={key} className="min-w-0 space-y-2" aria-describedby={describedBy}>
              <legend className="text-sm text-sf-body">{t(`marketing.${key}`)}</legend>
              {copy[key].map((item, index) => (
                <div key={index} className="flex flex-wrap gap-2">
                  <label htmlFor={`${id}-${key}-${index}`} className="sr-only">{t(`marketing.${key}`)} {index + 1}</label>
                  <input id={`${id}-${key}-${index}`} lang={editingLocale} className={`${controlClass} flex-1`} value={item} aria-describedby={describedBy} aria-invalid={!valid}
                    onChange={event => updateCopy({ ...copy, [key]: copy[key].map((value, i) => i === index ? event.target.value : value) })} />
                  <button type="button" className="text-sm underline focus:ring-2 focus:ring-sf-accent" aria-label={`${t(key === 'tools' ? 'marketing.removeTools' : 'marketing.removeRequirements')} ${index + 1}`}
                    onClick={() => {
                      focusTarget.current = copy[key].length > 1 ? `${id}-${key}-${Math.min(index, copy[key].length - 2)}` : `${id}-add-${key}`;
                      updateCopy({ ...copy, [key]: copy[key].filter((_, i) => i !== index) });
                    }}>{t('marketing.remove')}</button>
                </div>
              ))}
              <button id={`${id}-add-${key}`} type="button" className="text-sm underline disabled:opacity-50 focus:ring-2 focus:ring-sf-accent" disabled={copy[key].length >= 12}
                onClick={() => { focusTarget.current = `${id}-${key}-${copy[key].length}`; updateCopy({ ...copy, [key]: [...copy[key], ''] }); }}>{t(key === 'tools' ? 'marketing.addTools' : 'marketing.addRequirements')}</button>
            </fieldset>
          ))}
          {editingLocale !== fields.sourceLocale && <button type="button" className="text-sm underline focus:ring-2 focus:ring-sf-accent" onClick={() => {
            focusTarget.current = `${id}-locale`;
            const next = { ...fields };
            delete next[editingLocale];
            update(next);
          }}>{t('marketing.removeTranslation')}</button>}
        </>}
      </div>
    </ModalSection>
  );
}
