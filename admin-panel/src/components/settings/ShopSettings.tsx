'use client';

import { useState, useEffect } from 'react';
import { getShopConfig, updateShopConfig, type ShopConfig } from '@/lib/actions/shop-config';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';

const CURRENCIES = [
 { code: 'USD', symbol: '$', name: 'US Dollar' },
 { code: 'EUR', symbol: '€', name: 'Euro' },
 { code: 'GBP', symbol: '£', name: 'British Pound' },
 { code: 'PLN', symbol: 'zł', name: 'Polish Złoty' },
 { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
 { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
 { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
];

export default function ShopSettings() {
 const t = useTranslations('settings.shop');
 const { addToast } = useToast();
 const [config, setConfig] = useState<ShopConfig | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);

 const [formData, setFormData] = useState({
 default_currency: 'USD',
 shop_name: '',
 contact_email: '',
 tax_rate: '',
 });

 useEffect(() => {
 async function loadConfig() {
 try {
 const data = await getShopConfig();
 if (data) {
 setConfig(data);
 setFormData({
 default_currency: data.default_currency,
 shop_name: data.shop_name,
 contact_email: data.contact_email || '',
 tax_rate: data.tax_rate ? Math.round(data.tax_rate * 100).toString() : '',
 });
 }
 } catch (error) {
 console.error('Failed to load shop config:', error);
 } finally {
 setLoading(false);
 }
 }
 loadConfig();
 }, []);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setSaving(true);

 try {
 const updates: Partial<ShopConfig> = {
 default_currency: formData.default_currency,
 shop_name: formData.shop_name,
 contact_email: formData.contact_email || null,
 tax_rate: formData.tax_rate ? parseFloat(formData.tax_rate) / 100 : null,
 };

 const success = await updateShopConfig(updates);

 if (success) {
 addToast(t('saveSuccess'), 'success');
 // Reload config
 const newConfig = await getShopConfig();
 if (newConfig) setConfig(newConfig);
 } else {
 addToast(t('saveError'), 'error');
 }
 } catch (error) {
 console.error('Error saving settings:', error);
 addToast(t('saveError'), 'error');
 } finally {
 setSaving(false);
 }
 };

 if (loading) {
 return (
 <div className="bg-gf-base border-2 border-gf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-gf-raised w-1/4"></div>
 <div className="h-10 bg-gf-raised"></div>
 <div className="h-10 bg-gf-raised"></div>
 </div>
 </div>
 );
 }

 return (
 <div className="bg-gf-base border-2 border-gf-border-medium p-6">
 <h2 className="text-xl font-semibold text-gf-heading mb-6">
 {t('title')}
 </h2>

 <form onSubmit={handleSubmit} className="space-y-6">
 {/* Shop Name */}
 <div>
 <label htmlFor="shop-name" className="block text-sm font-medium text-gf-body mb-2">
 {t('shopName')}
 </label>
 <input
 id="shop-name"
 type="text"
 value={formData.shop_name}
 onChange={(e) => setFormData({ ...formData, shop_name: e.target.value })}
 className="w-full px-4 py-2 border-2 border-gf-border-medium bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
 placeholder={t('shopNamePlaceholder')}
 required
 />
 </div>

 {/* Default Currency */}
 <div>
 <label htmlFor="shop-currency" className="block text-sm font-medium text-gf-body mb-2">
 {t('defaultCurrency')}
 <span className="block text-xs text-gf-muted font-normal mt-1">
 {t('defaultCurrencyHelp')}
 </span>
 </label>
 <select
 id="shop-currency"
 value={formData.default_currency}
 onChange={(e) => setFormData({ ...formData, default_currency: e.target.value })}
 className="w-full px-4 py-2 border-2 border-gf-border-medium bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
 >
 {CURRENCIES.map((currency) => (
 <option key={currency.code} value={currency.code}>
 {currency.symbol} {currency.code} - {currency.name}
 </option>
 ))}
 </select>
 </div>

 {/* Contact Email */}
 <div>
 <label htmlFor="shop-contact-email" className="block text-sm font-medium text-gf-body mb-2">
 {t('contactEmail')}
 </label>
 <input
 id="shop-contact-email"
 type="email"
 value={formData.contact_email}
 onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
 className="w-full px-4 py-2 border-2 border-gf-border-medium bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
 placeholder={t('contactEmailPlaceholder')}
 />
 </div>

 {/* Tax Rate */}
 <div>
 <label htmlFor="shop-tax-rate" className="block text-sm font-medium text-gf-body mb-2">
 {t('taxRate')}
 <span className="block text-xs text-gf-muted font-normal mt-1">
 {t('taxRateHelp')}
 </span>
 </label>
 <div className="flex items-center gap-2">
 <input
 id="shop-tax-rate"
 type="number"
 step="1"
 min="0"
 max="100"
 value={formData.tax_rate}
 onChange={(e) => setFormData({ ...formData, tax_rate: e.target.value })}
 className="w-32 px-4 py-2 border-2 border-gf-border-medium bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
 placeholder={t('taxRatePlaceholder')}
 />
 <span className="text-sm text-gf-muted">%</span>
 </div>
 </div>

 {/* Save Button */}
 <div className="flex justify-end">
 <button
 type="submit"
 disabled={saving}
 className="px-6 py-2 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
 >
 {saving ? t('saving') : t('saveButton')}
 </button>
 </div>
 </form>
 </div>
 );
}
