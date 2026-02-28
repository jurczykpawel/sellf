'use client';

/**
 * OmnibusSettings Component
 * Global toggle for EU Omnibus Directive (2019/2161) compliance
 */

import { useToast } from '@/contexts/ToastContext';
import { useState, useEffect } from 'react';
import { getShopConfig, updateShopConfig, type ShopConfig } from '@/lib/actions/shop-config';
import { useTranslations } from 'next-intl';

export default function OmnibusSettings() {
  const { addToast } = useToast();
  const t = useTranslations('settings.omnibus');
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [omnibusEnabled, setOmnibusEnabled] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      try {
        const data = await getShopConfig();
        if (data) {
          setConfig(data);
          setOmnibusEnabled(data.omnibus_enabled ?? true);
        }
      } catch (error) {
        console.error('Failed to load omnibus config:', error);
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
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
        addToast(t('saveSuccess'), 'success');
        // Reload config and sync state
        const newConfig = await getShopConfig();
        if (newConfig) {
          setConfig(newConfig);
          setOmnibusEnabled(newConfig.omnibus_enabled ?? true);
        }
      } else {
        addToast(t('saveError'), 'error');
        // Revert on error
        setOmnibusEnabled(!newValue);
      }
    } catch (error) {
      console.error('Error saving omnibus settings:', error);
      addToast(t('saveError'), 'error');
      // Revert on error
      setOmnibusEnabled(!newValue);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gf-raised rounded w-1/3"></div>
          <div className="h-10 bg-gf-raised rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-gf-heading mb-2">
            {t('title')}
          </h2>
          <p className="text-sm text-gf-body mb-4">
            {t('description')}
          </p>

          <div className="bg-gf-accent-soft border border-gf-accent/20 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-medium text-gf-accent mb-2">
              ℹ️ {t('whatIsOmnibus')}
            </h3>
            <p className="text-xs text-gf-accent leading-relaxed">
              {t('omnibusExplanation')}
            </p>
          </div>

          {/* Toggle Switch */}
          <div className="flex items-center justify-between py-4 px-4 bg-gf-raised rounded-lg">
            <div>
              <span className="text-sm font-medium text-gf-heading">
                {t('enableOmnibus')}
              </span>
              <p className="text-xs text-gf-muted mt-1">
                {omnibusEnabled ? t('currentlyEnabled') : t('currentlyDisabled')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggle}
              disabled={saving}
              className={`
                relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gf-accent focus:ring-offset-2
                ${omnibusEnabled ? 'bg-gf-accent' : 'bg-gf-raised'}
                ${saving ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              role="switch"
              aria-checked={omnibusEnabled}
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
          <div className="mt-4 p-4 bg-gf-raised rounded-lg">
            <h4 className="text-xs font-medium text-gf-body mb-2">
              {t('additionalInfo')}
            </h4>
            <ul className="text-xs text-gf-body space-y-1 list-disc list-inside">
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
