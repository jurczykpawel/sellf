'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ModalSection } from '@/components/ui/Modal';
import { PostPurchaseSectionProps } from '../types';

export function PostPurchaseSection({
  formData,
  setFormData,
  t,
  products,
  loadingProducts,
  currentProductId,
  oto,
  setOto,
}: PostPurchaseSectionProps) {
  const tCommon = useTranslations('common');
  // Helper to detect if redirect URL points to an internal product
  const getSelectedProductFromUrl = () => {
    const url = formData.success_redirect_url || '';
    const match = url.match(/\/checkout\/([^/?]+)/);
    if (match) {
      const slug = match[1];
      return products.find(p => p.slug === slug) || null;
    }
    return null;
  };

  const selectedRedirectProduct = getSelectedProductFromUrl();
  const canShowOtoOption = selectedRedirectProduct && selectedRedirectProduct.price > 0 && selectedRedirectProduct.id !== currentProductId;

  const handleProductSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedSlug = e.target.value;
    if (!selectedSlug) {
      setFormData(prev => ({ ...prev, success_redirect_url: '' }));
      setOto(prev => ({ ...prev, productId: '', enabled: false }));
      return;
    }

    const selectedProduct = products.find(p => p.slug === selectedSlug);
    const currentUrl = formData.success_redirect_url || '';
    const queryParams = currentUrl.includes('?') ? currentUrl.split('?')[1] : '';
    const newUrl = `/checkout/${selectedSlug}${queryParams ? `?${queryParams}` : ''}`;

    setFormData(prev => ({ ...prev, success_redirect_url: newUrl }));

    if (selectedProduct && selectedProduct.price > 0) {
      setOto(prev => ({ ...prev, productId: selectedProduct.id }));
    } else {
      setOto(prev => ({ ...prev, productId: '', enabled: false }));
    }
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData(prev => ({ ...prev, success_redirect_url: value }));
    // Clear OTO if URL doesn't match a product
    const match = value.match(/\/checkout\/([^/?]+)/);
    if (!match) {
      setOto(prev => ({ ...prev, enabled: false, productId: '' }));
    }
  };

  const handleHideBumpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    let currentUrl = formData.success_redirect_url || '';

    try {
      const isRelative = currentUrl.startsWith('/');
      const baseUrl = 'http://dummy.com';
      const urlObj = new URL(currentUrl, baseUrl);

      if (isChecked) {
        urlObj.searchParams.set('hide_bump', 'true');
      } else {
        urlObj.searchParams.delete('hide_bump');
      }

      const newUrlString = isRelative
        ? urlObj.pathname + urlObj.search
        : urlObj.toString();

      setFormData(prev => ({ ...prev, success_redirect_url: newUrlString }));
    } catch {
      if (isChecked && !currentUrl.includes('hide_bump=true')) {
        const separator = currentUrl.includes('?') ? '&' : '?';
        setFormData(prev => ({ ...prev, success_redirect_url: `${currentUrl}${separator}hide_bump=true` }));
      } else if (!isChecked) {
        setFormData(prev => ({ ...prev, success_redirect_url: currentUrl.replace(/[?&]hide_bump=true/, '') }));
      }
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  return (
    <ModalSection title={t('postPurchase.title')} collapsible defaultExpanded={!!formData.success_redirect_url || oto.enabled}>
      <div className="space-y-4">
        {/* Product Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('postPurchase.redirectProduct', { defaultValue: 'Redirect to product' })}
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">({t('postPurchase.optional')})</span>
          </label>

          <select
            value={selectedRedirectProduct?.slug || ''}
            onChange={handleProductSelect}
            className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            disabled={loadingProducts}
          >
            <option value="">{loadingProducts ? tCommon('loading') : t('postPurchase.selectProductPlaceholder')}</option>
            {products
              .filter(p => p.id !== currentProductId)
              .map(p => (
                <option key={p.id} value={p.slug}>
                  {p.icon} {p.name} {p.price === 0 ? `(${t('free')})` : `- ${p.price} ${p.currency}`}
                </option>
              ))
            }
          </select>

          {/* Show selected product info */}
          {selectedRedirectProduct && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <span className="text-2xl">{selectedRedirectProduct.icon}</span>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{selectedRedirectProduct.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedRedirectProduct.price === 0 ? t('free') : `${selectedRedirectProduct.price} ${selectedRedirectProduct.currency}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleProductSelect({ target: { value: '' } } as React.ChangeEvent<HTMLSelectElement>)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Custom URL */}
          <div className="relative">
            <input
              type="text"
              id="success_redirect_url"
              name="success_redirect_url"
              value={formData.success_redirect_url || ''}
              onChange={handleUrlChange}
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              placeholder={t('postPurchase.redirectUrlPlaceholder')}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('postPurchase.redirectUrlHelp')}
          </p>
        </div>

        {/* Options (only show when redirect is set) */}
        {formData.success_redirect_url && (
          <div className="space-y-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="hide_bump"
                checked={formData.success_redirect_url?.includes('hide_bump=true') || false}
                onChange={handleHideBumpChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="hide_bump" className="ml-3 block text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                {t('postPurchase.hideBump')}
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="pass_params_to_redirect"
                name="pass_params_to_redirect"
                checked={formData.pass_params_to_redirect}
                onChange={handleCheckboxChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="pass_params_to_redirect" className="ml-3 block text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                {t('postPurchase.passParams')}
              </label>
            </div>
          </div>
        )}

        {/* OTO Option - Only show when internal product is selected */}
        {canShowOtoOption && (
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            {/* OTO Toggle */}
            <div className="flex items-center justify-between p-4 bg-gf-accent-soft rounded-lg border border-gf-border-accent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gf-accent-soft rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {t('oto.addDiscount', { defaultValue: 'Add time-limited discount' })}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('oto.addDiscountDesc', { defaultValue: 'Offer "{product}" at a special price', product: selectedRedirectProduct?.name })}
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={oto.enabled}
                  onChange={(e) => {
                    setOto(prev => ({
                      ...prev,
                      enabled: e.target.checked,
                      productId: e.target.checked && selectedRedirectProduct ? selectedRedirectProduct.id : prev.productId
                    }));
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-gf-accent rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-gf-accent"></div>
              </label>
            </div>

            {/* OTO Configuration */}
            {oto.enabled && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                {/* Discount Configuration */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('oto.discountType', { defaultValue: 'Discount Type' })}
                    </label>
                    <select
                      value={oto.discountType}
                      onChange={(e) => setOto(prev => ({ ...prev, discountType: e.target.value as 'percentage' | 'fixed' }))}
                      className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent dark:bg-gray-700 dark:text-white"
                    >
                      <option value="percentage">{t('oto.percentage', { defaultValue: 'Percentage (%)' })}</option>
                      <option value="fixed">{t('oto.fixed', { defaultValue: 'Fixed Amount' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('oto.discountValue', { defaultValue: 'Discount Value' })}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={oto.discountValue}
                        onChange={(e) => setOto(prev => ({ ...prev, discountValue: Math.max(0, Number(e.target.value)) }))}
                        min="0"
                        max={oto.discountType === 'percentage' ? 100 : undefined}
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent dark:bg-gray-700 dark:text-white pr-10"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                        {oto.discountType === 'percentage' ? '%' : formData.currency}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('oto.duration', { defaultValue: 'Offer Duration' })}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={oto.durationMinutes}
                      onChange={(e) => setOto(prev => ({ ...prev, durationMinutes: Math.max(1, Math.min(1440, Number(e.target.value))) }))}
                      min="1"
                      max="1440"
                      className="w-24 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('oto.minutes', { defaultValue: 'minutes' })}
                    </span>
                    <div className="flex gap-2 ml-auto">
                      {[5, 15, 30, 60].map(mins => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setOto(prev => ({ ...prev, durationMinutes: mins }))}
                          className={`px-2 py-1 text-xs rounded ${oto.durationMinutes === mins
                            ? 'bg-gf-accent text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                          }`}
                        >
                          {mins}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preview Box */}
                <div className="p-3 bg-gf-accent-soft rounded-lg border border-gf-border-accent">
                  <p className="text-sm text-gf-accent">
                    <span className="font-medium">{t('oto.preview', { defaultValue: 'Preview:' })}</span>{' '}
                    {t('oto.previewText', {
                      defaultValue: 'After purchasing this product, customer will see a {discount} discount on "{product}" for {duration} minutes.',
                      discount: oto.discountType === 'percentage' ? `${oto.discountValue}%` : `${oto.discountValue} ${formData.currency}`,
                      product: selectedRedirectProduct?.name || 'selected product',
                      duration: oto.durationMinutes
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info when no product selected */}
        {!formData.success_redirect_url && (
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('postPurchase.noRedirectInfo', { defaultValue: 'Select a product above to create a sales funnel with optional time-limited discount (OTO).' })}
            </p>
          </div>
        )}
      </div>
    </ModalSection>
  );
}
