'use client';

import React, { useRef } from 'react';
import { CURRENCIES, getCurrencySymbol } from '@/lib/constants';
import type { SectionProps } from '../types';
import type { TaxMode } from '@/lib/actions/shop-config';

interface PriceVatInlineProps extends SectionProps {
  priceDisplayValue: string;
  setPriceDisplayValue: (value: string) => void;
  shopDefaultVatRate: number | null;
  taxMode?: TaxMode;
  fieldErrors?: Record<string, string>;
  setFieldErrors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function PriceVatInline({
  formData,
  setFormData,
  t,
  priceDisplayValue,
  setPriceDisplayValue,
  shopDefaultVatRate,
  taxMode = 'local',
  fieldErrors = {},
  setFieldErrors,
}: PriceVatInlineProps) {
  const handleCurrencyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, currency: e.target.value }));
  };

  const presetsManuallyEdited = useRef(false);
  const minManuallyEdited = useRef(false);

  const getDefaultMin = (price: number): number => {
    if (price <= 0) return 1;
    return Math.max(0.50, Math.round(price * 0.5 * 10) / 10);
  };

  const getDefaultPresets = (price: number): [number, number, number] => {
    if (price <= 0) return [5, 10, 25];
    const round = (n: number) => Math.round(n);
    return [round(price), round(price * 1.5), round(price * 2)];
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    if (fieldErrors.price && setFieldErrors) {
      setFieldErrors(prev => { const next = { ...prev }; delete next.price; return next; });
    }

    if (inputValue === '') {
      setPriceDisplayValue('');
      setFormData(prev => ({
        ...prev,
        price: 0,
        ...(prev.allow_custom_price && {
          ...(!presetsManuallyEdited.current && { custom_price_presets: getDefaultPresets(0) }),
          ...(!minManuallyEdited.current && { custom_price_min: getDefaultMin(0) }),
        }),
      }));
      return;
    }

    if (!/^[\d,.]*$/.test(inputValue)) return;

    const processedValue = inputValue.replace(',', '.');
    const dotCount = (processedValue.match(/\./g) || []).length;
    if (dotCount > 1) return;

    if (/^\d*\.?\d{0,2}$/.test(processedValue)) {
      const numericValue = parseFloat(processedValue);
      const price = isNaN(numericValue) ? 0 : numericValue;
      setPriceDisplayValue(inputValue);
      setFormData(prev => ({
        ...prev,
        price,
        ...(prev.allow_custom_price && {
          ...(!presetsManuallyEdited.current && { custom_price_presets: getDefaultPresets(price) }),
          ...(!minManuallyEdited.current && { custom_price_min: getDefaultMin(price) }),
        }),
      }));
    }
  };

  const handleCustomPriceToggle = (enabled: boolean) => {
    presetsManuallyEdited.current = false;
    minManuallyEdited.current = false;
    setFormData(prev => ({
      ...prev,
      allow_custom_price: enabled,
      ...(enabled && {
        custom_price_min: getDefaultMin(prev.price),
        show_price_presets: prev.show_price_presets !== false,
        custom_price_presets: getDefaultPresets(prev.price),
      }),
    }));
  };

  const handleMinPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    minManuallyEdited.current = true;
    const value = parseFloat(e.target.value) || 0;
    setFormData(prev => ({ ...prev, custom_price_min: Math.max(0, value) }));
  };

  const handlePresetChange = (index: number, value: string) => {
    presetsManuallyEdited.current = true;
    const numValue = parseFloat(value) || 0;
    setFormData(prev => {
      const newPresets = [...(prev.custom_price_presets || [0, 0, 0])];
      newPresets[index] = numValue;
      return { ...prev, custom_price_presets: newPresets };
    });
  };

  const showCurrencyPrefix = formData.currency !== 'PLN' && formData.currency !== 'CHF';

  return (
    <div>
      {/* Price input row with inline VAT controls */}
      <label htmlFor="price" className="block text-sm font-medium text-sf-body mb-2">
        {t('price')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {/* Price + Currency — fixed width */}
        <div className="relative w-52">
          {showCurrencyPrefix && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-sf-muted text-sm">
                {getCurrencySymbol(formData.currency)}
              </span>
            </div>
          )}
          <input
            type="text"
            inputMode="decimal"
            id="price"
            name="price"
            value={priceDisplayValue}
            onChange={handlePriceChange}
            placeholder={!showCurrencyPrefix ? `${getCurrencySymbol(formData.currency)}` : ''}
            className={`${showCurrencyPrefix ? 'pl-9' : 'pl-3'} pr-[4.5rem] w-full py-2 border ${fieldErrors.price ? 'border-red-500 focus:ring-red-500' : 'border-sf-border focus:ring-sf-accent'} focus:outline-none focus:ring-2 focus:border-transparent bg-sf-input text-sf-heading`}
          />
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
            <select
              id="currency"
              name="currency"
              value={formData.currency}
              onChange={handleCurrencyChange}
              className="h-full py-0 pl-1 pr-6 border-transparent bg-transparent text-sf-muted text-sm focus:outline-none focus:ring-sf-accent focus:border-sf-accent"
            >
              {CURRENCIES.map(currency => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Brutto checkbox + VAT rate — wrap together */}
        {taxMode === 'stripe_tax' ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-sf-muted px-2 py-1.5 bg-sf-raised border border-sf-border">
              {t('vatStripeTaxInfo', { defaultValue: 'Tax calculated by Stripe' })}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <label htmlFor="price_includes_vat" className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                id="price_includes_vat"
                checked={formData.price_includes_vat}
                onChange={(e) => setFormData(prev => ({ ...prev, price_includes_vat: e.target.checked }))}
                className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
              />
              <span className="text-sm text-sf-body whitespace-nowrap">
                {formData.price_includes_vat ? t('vatIncluded') : t('vatExcluded')}
              </span>
            </label>

            {formData.price_includes_vat && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  id="vat_rate"
                  value={formData.vat_rate ?? ''}
                  onChange={(e) => {
                    if (fieldErrors.vat_rate && setFieldErrors) {
                      setFieldErrors(prev => { const next = { ...prev }; delete next.vat_rate; return next; });
                    }
                    setFormData(prev => ({
                      ...prev,
                      vat_rate: e.target.value === '' ? null : parseFloat(e.target.value)
                    }));
                  }}
                  min="0"
                  max="100"
                  step="1"
                  placeholder={shopDefaultVatRate != null ? `${Math.round(shopDefaultVatRate * 100)}` : ''}
                  required={shopDefaultVatRate == null}
                  className={`w-14 px-2 py-2 border-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent text-sm text-center ${
                    fieldErrors.vat_rate ? 'border-red-500' : 'border-sf-border-medium'
                  }`}
                />
                <span className="text-sm text-sf-muted">%</span>
              </div>
            )}
          </div>
        )}
      </div>

      {fieldErrors.price ? (
        <p className="mt-1.5 text-xs text-red-500">{t('price')} is required</p>
      ) : fieldErrors.vat_rate ? (
        <p className="mt-1.5 text-xs text-red-500">{t('vatRateRequired', { defaultValue: 'VAT rate is required (no default set in Tax settings)' })}</p>
      ) : (
        <p className="mt-1.5 text-xs text-sf-muted">
          {t('setToZeroForFree')}
        </p>
      )}

      {/* PWYW — checkbox reveals config */}
      <div className="mt-4">
        <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5 cursor-pointer select-none">
          <input
            type="checkbox"
            id="allow_custom_price"
            checked={formData.allow_custom_price}
            onChange={(e) => handleCustomPriceToggle(e.target.checked)}
            className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
          />
          <span className="text-sm font-medium text-sf-body">
            {t('customPricing.allowCustomPrice')}
          </span>
          <span className="text-xs text-sf-muted w-full pl-6 sm:w-auto sm:pl-0">
            {t('customPricing.allowCustomPriceHelp')}
          </span>
        </label>

        {formData.allow_custom_price && (
          <div className="mt-2 ml-6 space-y-2">
            <p className="text-xs text-sf-accent bg-sf-accent-soft px-2 py-1">
              {t('customPricing.suggestedPriceHint')}
            </p>

            <div className="flex items-center gap-2">
              <span className="text-xs text-sf-body">{t('customPricing.minimumPrice')}</span>
              <input
                type="number"
                id="custom_price_min"
                value={formData.custom_price_min}
                onChange={handleMinPriceChange}
                min="0"
                step="0.10"
                className="w-16 px-2 py-1 border-2 border-sf-border-medium text-sm focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
              />
              <span className="text-xs text-sf-muted">
                {formData.custom_price_min === 0
                  ? t('customPricing.freeOptionHint')
                  : `(${t('customPricing.stripeMinimum')})`}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="show_price_presets"
                  checked={formData.show_price_presets}
                  onChange={(e) => setFormData(prev => ({ ...prev, show_price_presets: e.target.checked }))}
                  className="h-3.5 w-3.5 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
                />
                <span className="text-xs text-sf-body">{t('customPricing.showPresets')}</span>
              </label>
              {formData.show_price_presets && [0, 1, 2].map((index) => (
                <input
                  key={index}
                  type="number"
                  value={formData.custom_price_presets?.[index] ?? 0}
                  onChange={(e) => handlePresetChange(index, e.target.value)}
                  min="0"
                  step="1"
                  placeholder="0"
                  className="w-14 px-1.5 py-1 border-2 border-sf-border-medium text-sm text-center focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
                />
              ))}
              {formData.show_price_presets && (
                <span className="text-xs text-sf-muted">(0 = ukryty)</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
