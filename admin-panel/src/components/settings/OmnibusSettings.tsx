'use client';

/**
 * OmnibusSettings Component
 * Global toggle for EU Omnibus Directive (2019/2161) compliance
 */

import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { getMyShopConfig, updateShopConfig, type ShopConfig } from '@/lib/actions/shop-config';
import { useTranslations } from 'next-intl';

export default function OmnibusSettings() {
 const t = useTranslations('settings.omnibus');
 const [config, setConfig] = useState<ShopConfig | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [omnibusEnabled, setOmnibusEnabled] = useState(true);

 useEffect(() => {
 let cancelled = false;
 async function loadConfig() {
 try {
 const data = await getMyShopConfig();
 if (cancelled) return;
 if (data) {
 setConfig(data);
 setOmnibusEnabled(data.omnibus_enabled ?? true);
 }
 } catch (error) {
 if (cancelled) return;
 console.error('Failed to load omnibus config:', error);
 } finally {
 if (!cancelled) setLoading(false);
 }
 }
 loadConfig();
 return () => { cancelled = true; };
 }, []);

 const handleToggle = async () => {
 const newValue = !omnibusEnabled;
 setOmnibusEnabled(newValue);
 setSaving(true);
 

 try {
 const updates: Partial<ShopConfig> = {
 omnibus_enabled: newValue,
 };

 const success = await updateShopConfig(updates);

 if (success) {
 toast.success(t('saveSuccess'));
 // Reload config and sync state
 const newConfig = await getMyShopConfig();
 if (newConfig) {
 setConfig(newConfig);
 setOmnibusEnabled(newConfig.omnibus_enabled ?? true);
 }
 } else {
 toast.error(t('saveError'));
 // Revert on error
 setOmnibusEnabled(!newValue);
 }
 } catch (error) {
 console.error('Error saving omnibus settings:', error);
 toast.error(t('saveError'));
 // Revert on error
 setOmnibusEnabled(!newValue);
 } finally {
 setSaving(false);
 }
 };

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/3"></div>
 <div className="h-10 bg-sf-raised"></div>
 </div>
 </div>
 );
 }

 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="flex items-start justify-between">
 <div className="flex-1">
 <h2 className="text-xl font-semibold text-sf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-body mb-4">
 {t('description')}
 </p>

 <div className="bg-sf-accent-soft border border-sf-accent/20 p-4 mb-4">
 <h3 className="text-sm font-medium text-sf-accent mb-2">
 ℹ️ {t('whatIsOmnibus')}
 </h3>
 <p className="text-xs text-sf-accent leading-relaxed">
 {t('omnibusExplanation')}
 </p>
 </div>

 {/* Toggle Switch */}
 <div className="flex items-center justify-between py-4 px-4 bg-sf-raised">
 <div>
 <span className="text-sm font-medium text-sf-heading">
 {t('enableOmnibus')}
 </span>
 <p className="text-xs text-sf-muted mt-1">
 {omnibusEnabled ? t('currentlyEnabled') : t('currentlyDisabled')}
 </p>
 </div>
 <button
 type="button"
 onClick={handleToggle}
 disabled={saving}
 className={`
 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sf-accent focus:ring-offset-2
 ${omnibusEnabled ? 'bg-sf-accent-bg' : 'bg-sf-raised'}
 ${saving ? 'opacity-50 cursor-not-allowed' : ''}
 `}
 role="switch"
 aria-checked={omnibusEnabled}
 aria-label={t('enableOmnibus')}
 >
 <span
 aria-hidden="true"
 className={`
 pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
 transition duration-200 ease-in-out
 ${omnibusEnabled ? 'translate-x-5' : 'translate-x-0'}
 `}
 />
 </button>
 </div>

 {/* Help Text */}
 <div className="mt-4 p-4 bg-sf-raised">
 <h4 className="text-xs font-medium text-sf-body mb-2">
 {t('additionalInfo')}
 </h4>
 <ul className="text-xs text-sf-body space-y-1 list-disc list-inside">
 <li>{t('info1')}</li>
 <li>{t('info2')}</li>
 <li>{t('info3')}</li>
 </ul>
 </div>
 </div>
 </div>
 </div>
 );
}
