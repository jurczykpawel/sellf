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
  urgency_duration_minutes: number | null;
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
  const [useUrgencyTimer, setUseUrgencyTimer] = useState(false);
  const [urgencyMinutes, setUrgencyMinutes] = useState<string>('');

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

      // Initialize urgency timer
      if (editingBump.urgency_duration_minutes != null && editingBump.urgency_duration_minutes > 0) {
        setUseUrgencyTimer(true);
        setUrgencyMinutes(editingBump.urgency_duration_minutes.toString());
      } else {
        setUseUrgencyTimer(false);
        setUrgencyMinutes('');
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

    if (useUrgencyTimer && urgencyMinutes) {
      formData.urgency_duration_minutes = parseInt(urgencyMinutes);
    } else {
      formData.urgency_duration_minutes = null;
    }

    await onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-sf-base max-w-2xl w-full my-8">
        <div className="p-6 border-b border-sf-border">
          <h2 className="text-2xl font-bold text-sf-heading">
            {editingBump ? t('edit') : t('create')}
          </h2>
          <p className="text-sf-body mt-1">
            {t('description')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Section: Products */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-sf-heading uppercase tracking-wider border-b border-sf-border pb-2">
              {t('form.productsConfiguration')}
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {t('form.mainProduct')} <span className="text-sf-danger">*</span>
                </label>
                <select
                  value={mainProductId}
                  onChange={(e) => setMainProductId(e.target.value)}
                  disabled={!!editingBump || loadingProducts}
                  required
                  className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading disabled:opacity-50"
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
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {t('form.bumpProduct')} <span className="text-sf-danger">*</span>
                </label>
                <select
                  value={bumpProductId}
                  onChange={(e) => setBumpProductId(e.target.value)}
                  disabled={loadingProducts}
                  required
                  className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading disabled:opacity-50"
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
            <h3 className="text-sm font-semibold text-sf-heading uppercase tracking-wider border-b border-sf-border pb-2">
              {t('form.offerDetails')}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {t('form.bumpTitle')} <span className="text-sf-danger">*</span>
                </label>
                <input
                  type="text"
                  value={bumpTitle}
                  onChange={(e) => setBumpTitle(e.target.value)}
                  placeholder={t('form.bumpTitlePlaceholder')}
                  required
                  maxLength={255}
                  className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {t('form.bumpDescription')}
                </label>
                <textarea
                  value={bumpDescription}
                  onChange={(e) => setBumpDescription(e.target.value)}
                  placeholder={t('form.bumpDescriptionPlaceholder')}
                  maxLength={1000}
                  rows={3}
                  className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
                />
              </div>
            </div>
          </div>

          {/* Section: Pricing & Access */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-sf-heading uppercase tracking-wider border-b border-sf-border pb-2">
              {t('form.pricing')}
            </h3>

            {selectedBumpProduct && (
              <div className="bg-sf-warning-soft border border-sf-warning/20 p-4">
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
                    <label htmlFor="useCustomPrice" className="block text-sm font-medium text-sf-heading cursor-pointer">
                      {t('form.useSpecialPrice')}
                    </label>
                    <p className="text-xs text-sf-body mt-1">
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
                          className="w-full px-4 py-2 border border-sf-warning/30 focus:ring-2 focus:ring-sf-warning bg-sf-input text-sf-heading"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-sf-body mb-3">
                {t('form.accessDuration')}
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div
                  onClick={() => { setAccessDurationType('default'); setAccessDuration(''); }}
                  className={`cursor-pointer border p-3 text-center transition-all ${
                    accessDurationType === 'default'
                      ? 'border-sf-accent bg-sf-accent-soft ring-1 ring-sf-accent'
                      : 'border-sf-border hover:border-sf-accent/50 bg-sf-base'
                  }`}
                >
                  <div className={`text-sm font-medium ${accessDurationType === 'default' ? 'text-sf-accent' : 'text-sf-heading'}`}>{t('form.useProductDefault')}</div>
                </div>

                <div
                  onClick={() => setAccessDurationType('custom')}
                  className={`cursor-pointer border p-3 text-center transition-all ${
                    accessDurationType === 'custom'
                      ? 'border-sf-accent bg-sf-accent-soft ring-1 ring-sf-accent'
                      : 'border-sf-border hover:border-sf-accent/50 bg-sf-base'
                  }`}
                >
                  <div className={`text-sm font-medium ${accessDurationType === 'custom' ? 'text-sf-accent' : 'text-sf-heading'}`}>{t('form.customDuration')}</div>
                </div>

                <div
                  onClick={() => { setAccessDurationType('unlimited'); setAccessDuration('0'); }}
                  className={`cursor-pointer border p-3 text-center transition-all ${
                    accessDurationType === 'unlimited'
                      ? 'border-sf-accent bg-sf-accent-soft ring-1 ring-sf-accent'
                      : 'border-sf-border hover:border-sf-accent/50 bg-sf-base'
                  }`}
                >
                  <div className={`text-sm font-medium ${accessDurationType === 'unlimited' ? 'text-sf-accent' : 'text-sf-heading'}`}>{t('form.unlimited')}</div>
                </div>
              </div>

              {accessDurationType === 'custom' && (
                <div className="mt-3">
                  <input
                    type="number"
                    min="1"
                    value={accessDuration === '0' ? '' : accessDuration}
                    onChange={(e) => setAccessDuration(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-sf-border-medium focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
                    placeholder={t('form.accessDurationPlaceholder')}
                    required
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section: Urgency Timer */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-sf-heading uppercase tracking-wider border-b border-sf-border pb-2">
              {t('form.urgencyTimer')}
            </h3>

            <div className="bg-sf-raised border border-sf-border p-4">
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="useUrgencyTimer"
                  checked={useUrgencyTimer}
                  onChange={(e) => {
                    setUseUrgencyTimer(e.target.checked);
                    if (!e.target.checked) setUrgencyMinutes('');
                  }}
                  className="mt-1 w-5 h-5 rounded border-sf-border text-red-600 focus:ring-red-500"
                />
                <div className="flex-1">
                  <label htmlFor="useUrgencyTimer" className="block text-sm font-medium text-sf-heading cursor-pointer">
                    {t('form.showUrgencyTimer')}
                  </label>
                  <p className="text-xs text-sf-muted mt-1">
                    {t('form.urgencyTimerHelp')}
                  </p>

                  {useUrgencyTimer && (
                    <div className="mt-3">
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        value={urgencyMinutes}
                        onChange={(e) => setUrgencyMinutes(e.target.value)}
                        placeholder={t('form.urgencyMinutesPlaceholder')}
                        required={useUrgencyTimer}
                        className="w-full px-4 py-2 border border-sf-border focus:ring-2 focus:ring-red-500 bg-sf-input text-sf-heading"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Active Status */}
          <div className="flex items-center space-x-3 pt-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-5 h-5 rounded border-sf-border text-sf-accent focus:ring-sf-accent"
            />
            <label htmlFor="isActive" className="text-sm font-medium text-sf-body cursor-pointer">
              {t('form.activeLabel')}
            </label>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-sf-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sf-body hover:bg-sf-hover transition-colors"
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-sf-accent-bg text-white hover:bg-sf-accent-hover transition-colors disabled:opacity-50 flex items-center space-x-2"
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
    </div>
  );
};

export default OrderBumpFormModal;