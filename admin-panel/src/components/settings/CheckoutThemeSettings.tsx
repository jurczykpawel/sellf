'use client';

import { useState, useEffect } from 'react';
import { getShopConfig, updateShopConfig } from '@/lib/actions/shop-config';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';

const THEME_OPTIONS = [
  { value: 'system', icon: '💻' },
  { value: 'light', icon: '☀️' },
  { value: 'dark', icon: '🌙' },
] as const;

export default function CheckoutThemeSettings() {
  const t = useTranslations('settings.checkoutTheme');
  const { addToast } = useToast();
  const [theme, setTheme] = useState<string>('system');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const config = await getShopConfig();
        if (config?.checkout_theme) {
          setTheme(config.checkout_theme);
        }
      } catch (error) {
        console.error('Failed to load checkout theme:', error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async (newTheme: string) => {
    setTheme(newTheme);
    setSaving(true);
    try {
      const success = await updateShopConfig({ checkout_theme: newTheme as any });
      if (success) {
        addToast(t('saveSuccess'), 'success');
      } else {
        addToast(t('saveError'), 'error');
      }
    } catch (error) {
      console.error('Error saving checkout theme:', error);
      addToast(t('saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gf-raised rounded w-1/4"></div>
          <div className="h-10 bg-gf-raised rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
      <h2 className="text-xl font-semibold text-gf-heading mb-2">
        {t('title')}
      </h2>
      <p className="text-sm text-gf-muted mb-6">
        {t('description')}
      </p>

      <div className="flex gap-3">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => handleSave(option.value)}
            disabled={saving}
            className={`flex-1 flex flex-col items-center gap-2 px-4 py-4 rounded-lg border-2 transition-all ${
              theme === option.value
                ? 'border-gf-border-accent bg-gf-accent-soft'
                : 'border-gf-border hover:border-gf-accent/50'
            } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className="text-2xl">{option.icon}</span>
            <span className={`text-sm font-medium ${
              theme === option.value
                ? 'text-gf-accent'
                : 'text-gf-body'
            }`}>
              {t(option.value)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
