'use client';

import { useState } from 'react';
import { updateShopConfig } from '@/lib/actions/shop-config';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

const THEME_OPTIONS = [
 { value: 'system', icon: '💻', descKey: 'systemDesc' },
 { value: 'light', icon: '☀️', descKey: 'lightDesc' },
 { value: 'dark', icon: '🌙', descKey: 'darkDesc' },
] as const;

interface CheckoutThemeSettingsProps {
  initialTheme?: string | null;
}

export default function CheckoutThemeSettings({ initialTheme }: CheckoutThemeSettingsProps = {}) {
 const t = useTranslations('settings.checkoutTheme');
 // Theme is pre-loaded server-side and passed in as a prop — no async
 // useEffect fetch chain that races the first render after page reload.
 const [theme, setTheme] = useState<string>(initialTheme || 'system');
 const [saving, setSaving] = useState(false);

 const handleSave = async (newTheme: string) => {
 setTheme(newTheme);
 setSaving(true);
 try {
 const success = await updateShopConfig({ checkout_theme: newTheme as any });
 if (success) {
 toast.success(t('saveSuccess'));
 } else {
 toast.error(t('saveError'));
 }
 } catch (error) {
 console.error('Error saving checkout theme:', error);
 toast.error(t('saveError'));
 } finally {
 setSaving(false);
 }
 };

 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <h2 className="text-xl font-semibold text-sf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-muted mb-6">
 {t('description')}
 </p>

 <div className="flex gap-3">
 {THEME_OPTIONS.map((option) => (
 <button
 key={option.value}
 onClick={() => handleSave(option.value)}
 disabled={saving}
 className={`flex-1 flex flex-col items-center gap-2 px-4 py-4 border-2 transition-all ${
 theme === option.value
 ? 'border-sf-border-accent bg-sf-accent-soft'
 : 'border-sf-border hover:border-sf-accent/50'
 } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
 >
 <span className="text-2xl">{option.icon}</span>
 <span className={`text-sm font-medium ${
 theme === option.value
 ? 'text-sf-accent'
 : 'text-sf-body'
 }`}>
 {t(option.value)}
 </span>
 </button>
 ))}
 </div>

 <p className="text-xs text-sf-muted mt-4">
 {t(`${theme}Desc`)}
 </p>

 <p className="text-xs text-sf-muted mt-3 border-t border-sf-border pt-3">
 {t('hint')}
 </p>
 </div>
 );
}
