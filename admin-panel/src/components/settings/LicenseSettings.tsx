'use client';

import { useState, useEffect } from 'react';
import { getIntegrationsConfig, updateIntegrationsConfig } from '@/lib/actions/integrations';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';

export default function LicenseSettings() {
  const t = useTranslations('settings.license');
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [license, setLicense] = useState('');

  useEffect(() => {
    async function loadLicense() {
      try {
        const config = await getIntegrationsConfig();
        if (config?.sellf_license) {
          setLicense(config.sellf_license);
        }
      } catch (error) {
        console.error('Failed to load license:', error);
      } finally {
        setLoading(false);
      }
    }
    loadLicense();
  }, []);

  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setValidationError(null);

    try {
      const result = await updateIntegrationsConfig({ sellf_license: license || null });

      if (result.error) {
        // Extract specific error message for license
        const licenseError = result.details?.sellf_license?.[0];
        if (licenseError) {
          setValidationError(licenseError);
          addToast(licenseError, 'error');
        } else {
          addToast(result.error, 'error');
        }
      } else {
        setValidationError(null);
        addToast(t('saveSuccess'), 'success');
      }
    } catch (error) {
      console.error('Error saving license:', error);
      addToast(t('saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const parseLicense = (licenseKey: string): { valid: true; domain: string; expiry: string; signature: string } | { valid: false } => {
    const parts = licenseKey.split('-');
    if (parts.length >= 3 && parts[0] === 'SF') {
      return {
        valid: true,
        domain: parts[1],
        expiry: parts[2],
        signature: parts.slice(3).join('-'),
      };
    }
    return { valid: false };
  };

  const licenseInfo = license ? parseLicense(license) : null;

  if (loading) {
    return (
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gf-raised rounded w-1/4"></div>
          <div className="h-10 bg-gf-raised rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border overflow-hidden">
      <div className="bg-gf-accent-soft px-6 py-4 border-b border-gf-border-accent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gf-accent flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gf-heading">
              {t('title')}
            </h2>
            <p className="text-sm text-gf-accent">
              {t('subtitle')}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gf-body mb-2">
            {t('licenseKey')}
          </label>
          <input
            type="text"
            placeholder={t('keyPlaceholder')}
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            className="w-full rounded-lg border border-gf-border px-4 py-3 bg-gf-input focus:ring-2 focus:ring-gf-accent outline-none font-mono text-sm"
          />
          <p className="mt-2 text-xs text-gf-muted">
            {t('formatHint')}
          </p>
          {validationError && (
            <p className="mt-2 text-sm text-gf-danger flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {validationError}
            </p>
          )}
        </div>

        {license && licenseInfo && (
          <div className="p-4 bg-gf-deep rounded-lg border border-gf-border">
            <h4 className="text-sm font-medium text-gf-body mb-3">
              {t('licenseDetails')}
            </h4>
            {licenseInfo.valid ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gf-muted">{t('domain')}:</span>
                  <span className="font-mono text-gf-heading">{licenseInfo.domain}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gf-muted">{t('expires')}:</span>
                  <span className={`font-mono ${licenseInfo.expiry === 'UNLIMITED' ? 'text-gf-success' : 'text-gf-heading'}`}>
                    {licenseInfo.expiry === 'UNLIMITED'
                      ? t('never')
                      : `${licenseInfo.expiry.slice(0,4)}-${licenseInfo.expiry.slice(4,6)}-${licenseInfo.expiry.slice(6,8)}`
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gf-muted">{t('signature')}:</span>
                  <span className="font-mono text-gray-400 text-xs">
                    {licenseInfo.signature?.slice(0, 20)}...
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gf-danger">{t('invalidFormat')}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-gf-border">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-gf-accent hover:bg-gf-accent-hover text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
          >
            {saving ? t('saving') : t('saveLicense')}
          </button>
        </div>
      </form>

      <div className="px-6 pb-6">
        <div className="bg-gf-deep rounded-lg p-4 text-sm text-gf-body">
          <h4 className="font-medium text-gf-heading mb-2">{t('howItWorks')}</h4>
          <ul className="space-y-1 list-disc list-inside">
            <li>{t('howItWorks1')}</li>
            <li>{t('howItWorks2')}</li>
            <li>{t('howItWorks3')}</li>
            <li>
              {t('howItWorks4')}{' '}
              <a
                href="https://demo.sellf.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gf-accent hover:underline"
              >
                demo.sellf.app
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
