'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import DateTimePicker from '@/components/ui/DateTimePicker';
import { getCurrencySymbol } from '@/lib/constants';
import { SalePriceSectionProps } from '../types';

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
    <ModalSection title={t('salePrice')} collapsible defaultExpanded={!!formData.sale_price}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sale_price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('salePriceLabel')}
            </label>
            <div className="relative rounded-lg shadow-sm">
              {showCurrencyPrefix && (
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 dark:text-gray-400 text-sm min-w-[24px]">
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
                className={`${showCurrencyPrefix ? 'pl-12' : 'pl-3'} pr-12 w-full py-2.5 border ${salePriceInvalid ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white`}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span className="text-gray-500 dark:text-gray-400 text-sm">
                  {formData.currency}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('salePriceDescription')}
            </p>
            {salePriceInvalid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
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
            <label htmlFor="sale_quantity_limit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('saleQuantityLimit', { defaultValue: 'Quantity Limit' })}
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">({t('optional')})</span>
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
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              placeholder={t('saleQuantityLimitPlaceholder', { defaultValue: 'No limit' })}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('saleQuantityLimitDescription', { defaultValue: 'Max units at sale price. Leave empty for unlimited.' })}
            </p>
          </div>

          {/* Quantity Sold Display & Reset */}
          {formData.sale_quantity_sold !== undefined && formData.sale_quantity_sold > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('saleQuantitySoldLabel', { defaultValue: 'Sold at Sale Price' })}
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2.5 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formData.sale_quantity_sold}
                  </span>
                  {formData.sale_quantity_limit && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {' / '}{formData.sale_quantity_limit}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, sale_quantity_sold: 0 }))}
                  className="px-3 py-2.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-800 transition-colors"
                  title={t('resetSaleCounter', { defaultValue: 'Reset counter' })}
                >
                  {t('reset', { defaultValue: 'Reset' })}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('saleQuantitySoldDescription', { defaultValue: 'Number of units sold at the promotional price.' })}
              </p>
            </div>
          )}
        </div>

        {salePriceActive && (
          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              ℹ️ {t('salePriceActiveInfo')}
            </p>
          </div>
        )}

        {/* Warning when quantity limit is reached */}
        {quantityLimitReached && (
          <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-700">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              ⚠️ {t('saleQuantityLimitReached', { defaultValue: 'Sale quantity limit reached. Customers will see the regular price.' })}
            </p>
          </div>
        )}
      </div>
    </ModalSection>
  );
}
