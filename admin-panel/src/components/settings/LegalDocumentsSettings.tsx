'use client';

import { useState, useEffect } from 'react';
import { getMyShopConfig, updateShopConfig, type ShopConfig } from '@/lib/actions/shop-config';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function LegalDocumentsSettings() {
 const t = useTranslations('settings.legal');
 const [config, setConfig] = useState<ShopConfig | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);

 const [formData, setFormData] = useState({
 terms_of_service_url: '',
 privacy_policy_url: '',
 });

 useEffect(() => {
 let cancelled = false;
 async function loadConfig() {
 try {
 const data = await getMyShopConfig();
 if (cancelled) return;
 if (data) {
 setConfig(data);
 setFormData({
 terms_of_service_url: data.terms_of_service_url || '',
 privacy_policy_url: data.privacy_policy_url || '',
 });
 }
 } catch (error) {
 if (cancelled) return;
 console.error('Failed to load shop config:', error);
 } finally {
 if (!cancelled) setLoading(false);
 }
 }
 loadConfig();
 return () => { cancelled = true; };
 }, []);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setSaving(true);

 try {
 const updates: Partial<ShopConfig> = {
 terms_of_service_url: formData.terms_of_service_url || null,
 privacy_policy_url: formData.privacy_policy_url || null,
 };

 const success = await updateShopConfig(updates);

 if (success) {
 toast.success(t('saveSuccess'));
 const newConfig = await getMyShopConfig();
 if (newConfig) setConfig(newConfig);
 } else {
 toast.error(t('saveError'));
 }
 } catch (error) {
 console.error('Error saving legal documents:', error);
 toast.error(t('saveError'));
 } finally {
 setSaving(false);
 }
 };

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/4"></div>
 <div className="h-10 bg-sf-raised"></div>
 <div className="h-10 bg-sf-raised"></div>
 </div>
 </div>
 );
 }

 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <h2 className="text-xl font-semibold text-sf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-body mb-6">
 {t('description')}
 </p>

 <form onSubmit={handleSubmit} className="space-y-6">
 {/* Terms of Service URL */}
 <div>
 <label htmlFor="legal-terms-url" className="block text-sm font-medium text-sf-body mb-2">
 {t('termsOfServiceUrl')}
 </label>
 <input
 id="legal-terms-url"
 type="url"
 value={formData.terms_of_service_url}
 onChange={(e) => setFormData({ ...formData, terms_of_service_url: e.target.value })}
 className="w-full px-4 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
 placeholder={t('termsPlaceholder')}
 />
 <p className="mt-1 text-xs text-sf-muted">
 {t('termsHelp')}
 </p>
 </div>

 {/* Privacy Policy URL */}
 <div>
 <label htmlFor="legal-privacy-url" className="block text-sm font-medium text-sf-body mb-2">
 {t('privacyPolicyUrl')}
 </label>
 <input
 id="legal-privacy-url"
 type="url"
 value={formData.privacy_policy_url}
 onChange={(e) => setFormData({ ...formData, privacy_policy_url: e.target.value })}
 className="w-full px-4 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
 placeholder={t('privacyPlaceholder')}
 />
 <p className="mt-1 text-xs text-sf-muted">
 {t('privacyHelp')}
 </p>
 </div>

 {/* Info Box */}
 <div className="p-4 bg-sf-accent-soft border border-sf-accent/20">
 <div className="flex gap-3">
 <span className="text-sf-accent text-lg">ℹ️</span>
 <div className="text-sm text-sf-accent">
 <p className="font-medium mb-1">{t('infoTitle')}</p>
 <p className="text-sf-accent">{t('infoDescription')}</p>
 <div className="mt-2 flex gap-4">
 <a
 href="/terms"
 target="_blank"
 className="text-sf-accent underline hover:no-underline"
 >
 /terms
 </a>
 <a
 href="/privacy"
 target="_blank"
 className="text-sf-accent underline hover:no-underline"
 >
 /privacy
 </a>
 </div>
 </div>
 </div>
 </div>

 {/* Save Button */}
 <div className="flex justify-end">
 <button
 type="submit"
 disabled={saving}
 className="px-6 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
 >
 {saving ? t('saving') : t('saveButton')}
 </button>
 </div>
 </form>
 </div>
 );
}
