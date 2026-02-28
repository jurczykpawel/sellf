'use client';

import { useState, useEffect } from 'react';
import { getShopConfig, updateShopConfig, type ShopConfig } from '@/lib/actions/shop-config';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';

export default function LegalDocumentsSettings() {
  const t = useTranslations('settings.legal');
  const { addToast } = useToast();
  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    terms_of_service_url: '',
    privacy_policy_url: '',
  });

  useEffect(() => {
    async function loadConfig() {
      try {
        const data = await getShopConfig();
        if (data) {
          setConfig(data);
          setFormData({
            terms_of_service_url: data.terms_of_service_url || '',
            privacy_policy_url: data.privacy_policy_url || '',
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
        terms_of_service_url: formData.terms_of_service_url || null,
        privacy_policy_url: formData.privacy_policy_url || null,
      };

      const success = await updateShopConfig(updates);

      if (success) {
        addToast(t('saveSuccess'), 'success');
        const newConfig = await getShopConfig();
        if (newConfig) setConfig(newConfig);
      } else {
        addToast(t('saveError'), 'error');
      }
    } catch (error) {
      console.error('Error saving legal documents:', error);
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
          <div className="h-10 bg-gf-raised rounded"></div>
          <div className="h-10 bg-gf-raised rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
      <h2 className="text-xl font-semibold text-gf-heading mb-2">
        {t('title')}
      </h2>
      <p className="text-sm text-gf-body mb-6">
        {t('description')}
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Terms of Service URL */}
        <div>
          <label className="block text-sm font-medium text-gf-body mb-2">
            {t('termsOfServiceUrl')}
          </label>
          <input
            type="url"
            value={formData.terms_of_service_url}
            onChange={(e) => setFormData({ ...formData, terms_of_service_url: e.target.value })}
            className="w-full px-4 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
            placeholder={t('termsPlaceholder')}
          />
          <p className="mt-1 text-xs text-gf-muted">
            {t('termsHelp')}
          </p>
        </div>

        {/* Privacy Policy URL */}
        <div>
          <label className="block text-sm font-medium text-gf-body mb-2">
            {t('privacyPolicyUrl')}
          </label>
          <input
            type="url"
            value={formData.privacy_policy_url}
            onChange={(e) => setFormData({ ...formData, privacy_policy_url: e.target.value })}
            className="w-full px-4 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent"
            placeholder={t('privacyPlaceholder')}
          />
          <p className="mt-1 text-xs text-gf-muted">
            {t('privacyHelp')}
          </p>
        </div>

        {/* Info Box */}
        <div className="p-4 bg-gf-accent-soft rounded-lg border border-gf-accent/20">
          <div className="flex gap-3">
            <span className="text-gf-accent text-lg">ℹ️</span>
            <div className="text-sm text-gf-accent">
              <p className="font-medium mb-1">{t('infoTitle')}</p>
              <p className="text-gf-accent">{t('infoDescription')}</p>
              <div className="mt-2 flex gap-4">
                <a
                  href="/terms"
                  target="_blank"
                  className="text-gf-accent underline hover:no-underline"
                >
                  /terms
                </a>
                <a
                  href="/privacy"
                  target="_blank"
                  className="text-gf-accent underline hover:no-underline"
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
            className="px-6 py-2 bg-gf-accent hover:bg-gf-accent-hover text-gf-inverse font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('saving') : t('saveButton')}
          </button>
        </div>
      </form>
    </div>
  );
}
