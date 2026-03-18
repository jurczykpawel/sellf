'use client';

import { useState, useEffect } from 'react';
import { getIntegrationsConfig, updateIntegrationsConfig } from '@/lib/actions/integrations';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function LicenseSettings() {
 const t = useTranslations('settings.license');
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [license, setLicense] = useState('');

 useEffect(() => {
 async function loadLicense() {
 try {
 const result = await getIntegrationsConfig();
 const data = result?.success ? result.data as Record<string, unknown> : null;
 if (data?.sellf_license) {
 setLicense(data.sellf_license as string);
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
 const result = await updateIntegrationsConfig({ sellf_license: license || null }) as { success: boolean; error?: string; details?: Record<string, string[]> };

 if (!result.success || result.error) {
 // Extract specific error message for license
 const licenseError = result.details?.sellf_license?.[0];
 if (licenseError) {
 setValidationError(licenseError);
 toast.error(licenseError);
 } else {
 toast.error(result.error || 'Unknown error');
 }
 } else {
 setValidationError(null);
 toast.success(t('saveSuccess'));
 }
 } catch (error) {
 console.error('Error saving license:', error);
 toast.error(t('saveError'));
 } finally {
 setSaving(false);
 }
 };

 const VALID_TIERS = ['REG', 'PRO', 'BIZ'];
 const TIER_LABELS: Record<string, string> = { REG: 'Registered Free', PRO: 'Pro', BIZ: 'Business' };

 const parseLicense = (licenseKey: string): { valid: true; domain: string; tier: string; expiry: string; signature: string } | { valid: false } => {
 const parts = licenseKey.split('-');
 if (parts.length < 4 || parts[0] !== 'SF') return { valid: false };

 // Current format: SF-{domain}-{TIER}-{expiry}-{signature}
 if (parts.length >= 5 && VALID_TIERS.includes(parts[2])) {
 return {
 valid: true,
 domain: parts[1],
 tier: parts[2],
 expiry: parts[3],
 signature: parts.slice(4).join('-'),
 };
 }

 // Legacy format: SF-{domain}-{expiry}-{signature}
 return {
 valid: true,
 domain: parts[1],
 tier: 'PRO',
 expiry: parts[2],
 signature: parts.slice(3).join('-'),
 };
 };

 const licenseInfo = license ? parseLicense(license) : null;

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/4"></div>
 <div className="h-10 bg-sf-raised"></div>
 </div>
 </div>
 );
 }

 return (
 <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
 <div className="bg-sf-accent-soft px-6 py-4 border-b border-sf-border-accent">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-sf-accent-bg flex items-center justify-center">
 <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
 </svg>
 </div>
 <div>
 <h2 className="text-lg font-semibold text-sf-heading">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-accent">
 {t('subtitle')}
 </p>
 </div>
 </div>
 </div>

 <form onSubmit={handleSubmit} className="p-6 space-y-6">
 <div>
 <label htmlFor="license-key" className="block text-sm font-medium text-sf-body mb-2">
 {t('licenseKey')}
 </label>
 <input
 id="license-key"
 type="text"
 placeholder={t('keyPlaceholder')}
 value={license}
 onChange={(e) => setLicense(e.target.value)}
 className="w-full border-2 border-sf-border-medium px-4 py-3 bg-sf-input focus:ring-2 focus:ring-sf-accent outline-none font-mono text-sm"
 />
 <p className="mt-2 text-xs text-sf-muted">
 {t('formatHint')}
 </p>
 {validationError && (
 <p className="mt-2 text-sm text-sf-danger flex items-center gap-1">
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 {validationError}
 </p>
 )}
 </div>

 {license && licenseInfo && (
 <div className="p-4 bg-sf-deep border-2 border-sf-border-medium">
 <h4 className="text-sm font-medium text-sf-body mb-3">
 {t('licenseDetails')}
 </h4>
 {licenseInfo.valid ? (
 <div className="space-y-2 text-sm">
 <div className="flex justify-between items-center">
 <span className="text-sf-muted">{t('domain')}:</span>
 <span className="font-mono text-sf-heading">{licenseInfo.domain}</span>
 </div>
 <div className="flex justify-between items-center">
 <span className="text-sf-muted">{t('tier')}:</span>
 <span className="font-mono text-sf-heading">
 {TIER_LABELS[licenseInfo.tier] || licenseInfo.tier}
 </span>
 </div>
 <div className="flex justify-between items-center">
 <span className="text-sf-muted">{t('expires')}:</span>
 <span className={`font-mono ${licenseInfo.expiry === 'UNLIMITED' ? 'text-sf-success' : 'text-sf-heading'}`}>
 {licenseInfo.expiry === 'UNLIMITED'
 ? t('never')
 : `${licenseInfo.expiry.slice(0,4)}-${licenseInfo.expiry.slice(4,6)}-${licenseInfo.expiry.slice(6,8)}`
 }
 </span>
 </div>
 <div className="flex justify-between items-center">
 <span className="text-sf-muted">{t('signature')}:</span>
 <span className="font-mono text-sf-muted text-xs">
 {licenseInfo.signature?.slice(0, 20)}...
 </span>
 </div>
 </div>
 ) : (
 <p className="text-sm text-sf-danger">{t('invalidFormat')}</p>
 )}
 </div>
 )}

 <div className="flex justify-end gap-3 pt-4 border-t border-sf-border">
 <button
 type="submit"
 disabled={saving}
 className="px-6 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
 >
 {saving ? t('saving') : t('saveLicense')}
 </button>
 </div>
 </form>

 <div className="px-6 pb-6">
 <div className="bg-sf-deep p-4 text-sm text-sf-body">
 <h4 className="font-medium text-sf-heading mb-2">{t('howItWorks')}</h4>
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
 className="text-sf-accent underline hover:no-underline"
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
