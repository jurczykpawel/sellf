'use client';

import React from 'react';
import DateTimePicker from '@/components/ui/DateTimePicker';
import { getCurrencySymbol } from '@/lib/constants';
import { SalePriceSectionProps } from '../types';
import { ConversionBadge } from './ConversionBadge';

export function SalePriceSection({
  formData,
  setFormData,
  t,
  salePriceDisplayValue,
  setSalePriceDisplayValue,
  omnibusEnabled,
}: SalePriceSectionProps) {
  const handleSalePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    if (inputValue === '') {
      setSalePriceDisplayValue('');
      setFormData(prev => ({ ...prev, sale_price: null }));
      return;
    }

    if (!/^[\d,.]*$/.test(inputValue)) return;

    const processedValue = inputValue.replace(',', '.');
    const dotCount = (processedValue.match(/\./g) || []).length;
    if (dotCount > 1) return;

    if (/^\d*\.?\d{0,2}$/.test(processedValue)) {
      const numericValue = parseFloat(processedValue);
      setSalePriceDisplayValue(inputValue);
      setFormData(prev => ({
        ...prev,
        sale_price: isNaN(numericValue) ? null : numericValue
      }));
    }
  };

  const showCurrencyPrefix = formData.currency !== 'PLN' && formData.currency !== 'CHF';
  const salePriceInvalid = formData.sale_price !== null && formData.sale_price !== undefined && formData.sale_price >= formData.price;
  const salePriceActive = formData.sale_price !== null && formData.sale_price !== undefined && formData.sale_price < formData.price;
  const quantityLimitReached = formData.sale_quantity_limit && formData.sale_quantity_sold !== undefined && formData.sale_quantity_sold >= formData.sale_quantity_limit;

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-sf-heading flex items-center gap-2">
        {t('salePrice')}
        <ConversionBadge label={t('conversionBadge.salePrice')} />
      </h4>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sale_price" className="block text-sm font-medium text-sf-body mb-2">
              {t('salePriceLabel')}
            </label>
            <div className="relative">
              {showCurrencyPrefix && (
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-sf-muted text-sm min-w-[24px]">
                    {getCurrencySymbol(formData.currency)}
                  </span>
                </div>
              )}
              <input
                type="text"
                inputMode="decimal"
                id="sale_price"
                name="sale_price"
                value={salePriceDisplayValue}
                onChange={handleSalePriceChange}
                placeholder={!showCurrencyPrefix ? `0,00 ${getCurrencySymbol(formData.currency)}` : t('salePricePlaceholder')}
                className={`${showCurrencyPrefix ? 'pl-12' : 'pl-3'} pr-12 w-full py-2.5 border ${salePriceInvalid ? 'border-red-500' : 'border-sf-border'} focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading`}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span className="text-sf-muted text-sm">
                  {formData.currency}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-sf-muted">
              {t('salePriceDescription')}
            </p>
            {salePriceInvalid && (
              <p className="mt-1 text-xs text-sf-danger">
                {t('salePriceMustBeLower')}
              </p>
            )}
          </div>

          <DateTimePicker
            label={t('salePriceUntil')}
            value={formData.sale_price_until || ''}
            onChange={(value) => setFormData(prev => ({ ...prev, sale_price_until: value }))}
            placeholder={t('selectEndDate')}
            description={t('salePriceUntilDescription')}
            showTimeSelect={true}
            minDate={new Date()}
          />
        </div>

        {/* Quantity Limit */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sale_quantity_limit" className="block text-sm font-medium text-sf-body mb-2">
              {t('saleQuantityLimit', { defaultValue: 'Quantity Limit' })}
              <span className="text-xs text-sf-muted ml-1">({t('optional')})</span>
            </label>
            <input
              type="number"
              id="sale_quantity_limit"
              min="1"
              value={formData.sale_quantity_limit || ''}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                sale_quantity_limit: e.target.value ? parseInt(e.target.value, 10) : null
              }))}
              className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
              placeholder={t('saleQuantityLimitPlaceholder', { defaultValue: 'No limit' })}
            />
            <p className="mt-1 text-xs text-sf-muted">
              {t('saleQuantityLimitDescription', { defaultValue: 'Max units at sale price. Leave empty for unlimited.' })}
            </p>
          </div>

          {/* Quantity Sold Display & Reset */}
          {formData.sale_quantity_sold !== undefined && formData.sale_quantity_sold > 0 && (
            <div>
              <label className="block text-sm font-medium text-sf-body mb-2">
                {t('saleQuantitySoldLabel', { defaultValue: 'Sold at Sale Price' })}
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2.5 bg-sf-raised border-2 border-sf-border-medium">
                  <span className="text-lg font-semibold text-sf-heading">
                    {formData.sale_quantity_sold}
                  </span>
                  {formData.sale_quantity_limit && (
                    <span className="text-sf-muted">
                      {' / '}{formData.sale_quantity_limit}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, sale_quantity_sold: 0 }))}
                  className="px-3 py-2.5 text-sm font-medium text-sf-danger bg-sf-danger-soft hover:bg-sf-danger-soft border border-sf-danger/20 transition-colors"
                  title={t('resetSaleCounter', { defaultValue: 'Reset counter' })}
                >
                  {t('reset', { defaultValue: 'Reset' })}
                </button>
              </div>
              <p className="mt-1 text-xs text-sf-muted">
                {t('saleQuantitySoldDescription', { defaultValue: 'Number of units sold at the promotional price.' })}
              </p>
            </div>
          )}
        </div>

        {salePriceActive && (
          <div className="bg-sf-accent-soft p-3">
            <p className="text-sm text-sf-accent">
              ℹ️ {t('salePriceActiveInfo')}
            </p>
          </div>
        )}

        {/* Warning when quantity limit is reached */}
        {quantityLimitReached && (
          <div className="bg-sf-warning-soft p-3 border border-sf-warning/20">
            <p className="text-sm text-sf-warning">
              ⚠️ {t('saleQuantityLimitReached', { defaultValue: 'Sale quantity limit reached. Customers will see the regular price.' })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
