'use client';

import React, { useState, useEffect } from 'react';
import { Product } from '@/types';
import { useTranslations } from 'next-intl';

interface OrderBumpWithDetails {
  id: string;
  main_product_id: string;
  bump_product_id: string;
  bump_price: number | null;
  bump_title: string;
  bump_description: string | null;
  is_active: boolean;
  display_order: number;
  access_duration_days: number | null;
  main_product: {
    id: string;
    name: string;
  };
  bump_product: {
    id: string;
    name: string;
    price: number;
    currency: string;
  };
}

interface OrderBumpFormModalProps {
  products: Product[];
  loadingProducts: boolean;
  editingBump: OrderBumpWithDetails | null;
  onSubmit: (formData: any) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
}

const OrderBumpFormModal: React.FC<OrderBumpFormModalProps> = ({
  products,
  loadingProducts,
  editingBump,
  onSubmit,
  onClose,
  isSubmitting,
}) => {
  const t = useTranslations('admin.orderBumps');
  
  // Form state
  const [mainProductId, setMainProductId] = useState('');
  const [bumpProductId, setBumpProductId] = useState('');
  const [bumpPrice, setBumpPrice] = useState<string>('');
  const [useCustomPrice, setUseCustomPrice] = useState(false);
  const [bumpTitle, setBumpTitle] = useState('');
  const [bumpDescription, setBumpDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [accessDuration, setAccessDuration] = useState<string>('');
  const [accessDurationType, setAccessDurationType] = useState<'default' | 'custom' | 'unlimited'>('default');

  // Selected products for info display
  const selectedBumpProduct = products.find(p => p.id === bumpProductId);

  // Initialize form with editing data
  useEffect(() => {
    if (editingBump) {
      setMainProductId(editingBump.main_product_id);
      setBumpProductId(editingBump.bump_product_id);
      setBumpTitle(editingBump.bump_title);
      setBumpDescription(editingBump.bump_description || '');
      setIsActive(editingBump.is_active);
      
      // Initialize Access Duration Type
      if (editingBump.access_duration_days === null || editingBump.access_duration_days === undefined) {
        setAccessDurationType('default');
        setAccessDuration('');
      } else if (editingBump.access_duration_days === 0) {
        setAccessDurationType('unlimited');
        setAccessDuration('0');
      } else {
        setAccessDurationType('custom');
        setAccessDuration(editingBump.access_duration_days.toString());
      }

      // Check if custom price is set
      if (editingBump.bump_price !== null) {
        setUseCustomPrice(true);
        setBumpPrice(editingBump.bump_price.toString());
      } else {
        setUseCustomPrice(false);
        setBumpPrice('');
      }
    }
  }, [editingBump]);

  // Auto-generate bump title when bump product changes
  useEffect(() => {
    if (bumpProductId && !editingBump && !bumpTitle) {
      const product = products.find(p => p.id === bumpProductId);
      if (product) {
        const priceDisplay = useCustomPrice && bumpPrice
          ? `${bumpPrice}`
          : `${product.price}`;
        // Note: Simple template, could be moved to i18n if needed but title is usually custom
        setBumpTitle(t('form.defaultTitle', { name: product.name, price: priceDisplay, currency: product.currency }));
      }
    }
  }, [bumpProductId, useCustomPrice, bumpPrice, products, editingBump, bumpTitle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const formData: any = {
      bump_title: bumpTitle,
      bump_description: bumpDescription || null,
      is_active: isActive,
      display_order: 0,
    };

    if (!editingBump) {
      formData.main_product_id = mainProductId;
      formData.bump_product_id = bumpProductId;
    } else {
      if (bumpProductId !== editingBump.bump_product_id) {
        formData.bump_product_id = bumpProductId;
      }
    }

    if (useCustomPrice && bumpPrice) {
      formData.bump_price = parseFloat(bumpPrice);
    } else {
      formData.bump_price = null;
    }

    if (accessDurationType === 'custom' && accessDuration !== '') {
      formData.access_duration_days = parseInt(accessDuration);
    } else if (accessDurationType === 'unlimited') {
      formData.access_duration_days = 0;
    } else {
      formData.access_duration_days = null;
    }

    await onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full my-8">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {editingBump ? t('edit') : t('create')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t('description')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Section: Products */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.productsConfiguration')}
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('form.mainProduct')} <span className="text-red-500">*</span>
                </label>
                <select
                  value={mainProductId}
                  onChange={(e) => setMainProductId(e.target.value)}
                  disabled={!!editingBump || loadingProducts}
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                >
                  <option value="">{t('form.selectProduct')}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.price} {product.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('form.bumpProduct')} <span className="text-red-500">*</span>
                </label>
                <select
                  value={bumpProductId}
                  onChange={(e) => setBumpProductId(e.target.value)}
                  disabled={loadingProducts}
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                >
                  <option value="">{t('form.selectProduct')}</option>
                  {products
                    .filter(p => p.id !== mainProductId)
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} ({product.price} {product.currency})
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section: Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.offerDetails')}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('form.bumpTitle')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={bumpTitle}
                  onChange={(e) => setBumpTitle(e.target.value)}
                  placeholder={t('form.bumpTitlePlaceholder')}
                  required
                  maxLength={255}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('form.bumpDescription')}
                </label>
                <textarea
                  value={bumpDescription}
                  onChange={(e) => setBumpDescription(e.target.value)}
                  placeholder={t('form.bumpDescriptionPlaceholder')}
                  maxLength={1000}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Section: Pricing & Access */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.pricing')}
            </h3>

            {selectedBumpProduct && (
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <input
                    type="checkbox"
                    id="useCustomPrice"
                    checked={useCustomPrice}
                    onChange={(e) => {
                      setUseCustomPrice(e.target.checked);
                      if (!e.target.checked) setBumpPrice('');
                    }}
                    className="mt-1 w-5 h-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div className="flex-1">
                    <label htmlFor="useCustomPrice" className="block text-sm font-medium text-gray-900 dark:text-white cursor-pointer">
                      {t('form.useSpecialPrice')}
                    </label>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {t('form.regularPrice')}: {selectedBumpProduct.price} {selectedBumpProduct.currency}
                    </p>

                    {useCustomPrice && (
                      <div className="mt-3">
                        <input
                          type="number"
                          name="bump_price"
                          step="0.01"
                          min="0"
                          value={bumpPrice}
                          onChange={(e) => setBumpPrice(e.target.value)}
                          placeholder={selectedBumpProduct.price.toString()}
                          required={useCustomPrice}
                          className="w-full px-4 py-2 border border-amber-300 dark:border-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {t('form.accessDuration')}
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div 
                  onClick={() => { setAccessDurationType('default'); setAccessDuration(''); }}
                  className={`cursor-pointer border rounded-lg p-3 text-center transition-all ${
                    accessDurationType === 'default' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 border-blue-500' 
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className={`text-sm font-medium ${accessDurationType === 'default' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{t('form.useProductDefault')}</div>
                </div>

                <div 
                  onClick={() => setAccessDurationType('custom')}
                  className={`cursor-pointer border rounded-lg p-3 text-center transition-all ${
                    accessDurationType === 'custom' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 border-blue-500' 
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className={`text-sm font-medium ${accessDurationType === 'custom' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{t('form.customDuration')}</div>
                </div>

                <div 
                  onClick={() => { setAccessDurationType('unlimited'); setAccessDuration('0'); }}
                  className={`cursor-pointer border rounded-lg p-3 text-center transition-all ${
                    accessDurationType === 'unlimited' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 border-blue-500' 
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className={`text-sm font-medium ${accessDurationType === 'unlimited' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{t('form.unlimited')}</div>
                </div>
              </div>

              {accessDurationType === 'custom' && (
                <div className="mt-3">
                  <input
                    type="number"
                    min="1"
                    value={accessDuration === '0' ? '' : accessDuration} 
                    onChange={(e) => setAccessDuration(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder={t('form.accessDurationPlaceholder')}
                    required
                  />
                </div>
              )}
            </div>
          </div>

          {/* Active Status */}
          <div className="flex items-center space-x-3 pt-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              {t('form.activeLabel')}
            </label>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center space-x-2 shadow-sm"
            >
              {isSubmitting ? (
                <span>{t('form.saving')}</span>
              ) : (
                <span>{t('form.save')}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrderBumpFormModal;