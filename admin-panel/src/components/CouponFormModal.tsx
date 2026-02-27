/**
 * Coupon Form Modal Component
 * 
 * 🤖 AI MAINTAINER NOTE:
 * Modern glassmorphism UI for creating/editing coupons.
 * CRITICAL LOGIC:
 * - Percentage discounts MUST have NULL currency (database constraint).
 * - 'Exclude Order Bumps' is only available for global coupons (no product restrictions).
 * - Email restrictions are used for 'Smart Auto-Apply' on the checkout page.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Coupon, CouponFormData } from '@/types/coupon';
import { Product } from '@/types';
import { CURRENCIES } from '@/lib/constants';
import { useTranslations } from 'next-intl';

interface CouponFormModalProps {
  products: Product[];
  editingCoupon: Coupon | null;
  onSubmit: (formData: any) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
}

const CouponFormModal: React.FC<CouponFormModalProps> = ({
  products,
  editingCoupon,
  onSubmit,
  onClose,
  isSubmitting,
}) => {
  const t = useTranslations('admin.coupons');
  const [formData, setFormData] = useState<Partial<CouponFormData>>({
    code: '',
    name: '',
    discount_type: 'percentage',
    discount_value: 0,
    currency: 'USD',
    is_active: true,
    usage_limit_global: null,
    usage_limit_per_user: 1,
    allowed_product_ids: [],
    allowed_emails: [],
    exclude_order_bumps: false
  });

  const [emailInput, setEmailInput] = useState('');

  useEffect(() => {
    if (editingCoupon) {
      setFormData({
        code: editingCoupon.code,
        name: editingCoupon.name || '',
        discount_type: editingCoupon.discount_type as 'percentage' | 'fixed',
        discount_value: editingCoupon.discount_value,
        currency: editingCoupon.currency || 'USD',
        is_active: editingCoupon.is_active,
        exclude_order_bumps: editingCoupon.exclude_order_bumps || false,
        usage_limit_global: editingCoupon.usage_limit_global,
        usage_limit_per_user: editingCoupon.usage_limit_per_user || 1,
        allowed_product_ids: (editingCoupon.allowed_product_ids as string[]) || [],
        allowed_emails: (editingCoupon.allowed_emails as string[]) || [],
        expires_at: editingCoupon.expires_at ? new Date(editingCoupon.expires_at).toISOString().split('T')[0] : null
      });
    }
  }, [editingCoupon]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Ensure currency is null for percentage discounts to satisfy DB constraint
    const submitData = { ...formData };
    if (submitData.discount_type === 'percentage') {
      submitData.currency = null;
    }
    
    await onSubmit(submitData);
  };

  const addEmail = () => {
    if (emailInput && !formData.allowed_emails?.includes(emailInput)) {
      setFormData(prev => ({
        ...prev,
        allowed_emails: [...(prev.allowed_emails || []), emailInput]
      }));
      setEmailInput('');
    }
  };

  const removeEmail = (email: string) => {
    setFormData(prev => ({
      ...prev,
      allowed_emails: prev.allowed_emails?.filter(e => e !== email)
    }));
  };

  const toggleProduct = (productId: string) => {
    const current = formData.allowed_product_ids || [];
    const newProducts = current.includes(productId)
      ? current.filter(id => id !== productId)
      : [...current, productId];
    setFormData(prev => ({ ...prev, allowed_product_ids: newProducts }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full my-8 border border-gray-200 dark:border-gray-700">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 rounded-t-2xl">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {editingCoupon ? t('edit') : t('create')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {t('description')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Section: Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.basicInfo')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('form.codeLabel')} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg uppercase font-mono tracking-wide focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder={t('form.codePlaceholder')}
                    required
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('form.nameLabel')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={t('form.namePlaceholder')}
                />
              </div>
            </div>
          </div>

          {/* Section: Discount Configuration */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.discountValue')}
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 grid grid-cols-2 gap-4">
                <div 
                  onClick={() => setFormData({ ...formData, discount_type: 'percentage', currency: null as any })}
                  className={`cursor-pointer border rounded-lg p-3 text-center transition-all ${
                    formData.discount_type === 'percentage' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500 dark:ring-blue-400' 
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className={`text-sm font-bold ${formData.discount_type === 'percentage' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{t('percentage')} (%)</div>
                </div>
                <div 
                  onClick={() => setFormData({ ...formData, discount_type: 'fixed' })}
                  className={`cursor-pointer border rounded-lg p-3 text-center transition-all ${
                    formData.discount_type === 'fixed' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500 dark:ring-blue-400' 
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className={`text-sm font-bold ${formData.discount_type === 'fixed' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{t('fixed')} ($)</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {formData.discount_type === 'percentage' ? t('percentage') : t('fixed')} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    name="discount_value"
                    min="0"
                    step={formData.discount_type === 'percentage' ? "1" : "0.01"}
                    max={formData.discount_type === 'percentage' ? "100" : undefined}
                    value={formData.discount_value}
                    onChange={e => setFormData({ ...formData, discount_value: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white pr-8"
                    required
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 dark:text-gray-400">
                      {formData.discount_type === 'percentage' ? '%' : ''}
                    </span>
                  </div>
                </div>
              </div>

              {formData.discount_type === 'fixed' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('form.currency')}</label>
                  <select
                    value={formData.currency || ''}
                    onChange={e => setFormData({ ...formData, currency: (e.target.value || null) as any })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">{t('form.anyCurrency')}</option>
                    {CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.name})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Section: Limits & Validity */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.limitations')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('form.usageLimit')}</label>
                <input
                  type="number"
                  min="0"
                  value={formData.usage_limit_global || ''}
                  onChange={e => setFormData({ ...formData, usage_limit_global: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={t('form.unlimited')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('form.perUserLimit')}</label>
                <input
                  type="number"
                  min="1"
                  value={formData.usage_limit_per_user}
                  onChange={e => setFormData({ ...formData, usage_limit_per_user: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('form.validUntil')}</label>
                <input
                  type="date"
                  value={formData.expires_at || ''}
                  onChange={e => setFormData({ ...formData, expires_at: e.target.value || null })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Section: Restrictions */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider border-b border-gray-200 dark:border-gray-700 pb-2">
              {t('form.restrictions')}
            </h3>
            
            {/* Products */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('form.productRestriction')}</label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2 bg-gray-50 dark:bg-gray-800/50">
                {products.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('noActiveProducts')}</p>
                ) : (
                  products.map(product => (
                    <label key={product.id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.allowed_product_ids?.includes(product.id)}
                        onChange={() => toggleProduct(product.id)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{product.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Exclude Order Bumps (Global Coupons only) */}
            {(!formData.allowed_product_ids || formData.allowed_product_ids.length === 0) && (
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.exclude_order_bumps || false}
                    onChange={e => setFormData({ ...formData, exclude_order_bumps: e.target.checked })}
                    className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{t('form.excludeOrderBumps')}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('form.excludeOrderBumpsHelp')}
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Emails */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('form.emailRestriction')}</label>
              <div className="flex space-x-2 mb-3">
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={t('form.emailPlaceholder')}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())}
                />
                <button
                  type="button"
                  onClick={addEmail}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                >
                  {t('form.add')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {formData.allowed_emails && formData.allowed_emails.length > 0 ? (
                  formData.allowed_emails.map(email => (
                    <span key={email} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      {email}
                      <button
                        type="button"
                        onClick={() => removeEmail(email)}
                        className="ml-2 h-4 w-4 rounded-full inline-flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <p className="text-xs text-gray-500 italic">{t('form.emailHelp')}</p>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-gray-700 mt-8">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.is_active}
                onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isActive" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                {t('form.activeLabel')}
              </label>
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-5 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium disabled:opacity-50"
              >
                {t('form.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 shadow-sm"
              >
                {isSubmitting ? t('form.saving') : (editingCoupon ? t('form.update') : t('form.save'))}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CouponFormModal;
