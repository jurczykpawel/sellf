'use client';

/**
 * LegalDocumentsSettings
 *
 * Settings section for legal document management. Covers two concerns:
 * 1. Manual URL inputs (existing) — fallback when using externally-hosted docs.
 * 2. Company data form + "Generate & Publish" button (new, Task 6).
 *
 * @see /api/legal/generate — POST endpoint called by the generate action.
 * @see /lib/actions/shop-config.ts — updateShopConfig server action.
 * @see /lib/legal/validate-seller.ts — list of required fields (mirrors missing[]).
 */

import { useState, useEffect } from 'react';
import { getMyShopConfig, getMyLegalDocsSource, updateShopConfig, type ShopConfig } from '@/lib/actions/shop-config';
import SourceBadge from '@/components/ui/SourceBadge';
import type { LegalDocsSource } from '@/lib/legal/legal-docs-source';
import { lookupCompanyByNip } from '@/lib/gus/lookup';
import { validateTaxId } from '@/lib/validation/nip';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

// ===== TYPES =====

type LegalFormValue = 'jdg' | 'spzoo' | 'fundacja' | 'osoba_fizyczna';

interface GenerateResult {
  ok: true;
  termsUrl: string;
  privacyUrl: string;
  warning?: string;
}

interface GenerateError {
  ok: false;
  error: string;
  missing?: string[];
}

type GenerateResponse = GenerateResult | GenerateError;

// Maps API missing[] field names to i18n keys under settings.legal.*
const MISSING_FIELD_KEYS: Record<string, string> = {
  name: 'missingFieldName',
  legalForm: 'missingFieldLegalForm',
  email: 'missingFieldEmail',
  street: 'missingFieldStreet',
  buildingNo: 'missingFieldBuildingNo',
  city: 'missingFieldCity',
  postal: 'missingFieldPostal',
};

// ===== COMPONENT =====

export default function LegalDocumentsSettings() {
  const t = useTranslations('settings.legal');

  const [config, setConfig] = useState<ShopConfig | null>(null);
  const [legalSource, setLegalSource] = useState<LegalDocsSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [generating, setGenerating] = useState(false);

  // ---- GUS NIP autofill state ----
  const [isLoadingGus, setIsLoadingGus] = useState(false);
  const [gusError, setGusError] = useState<string | null>(null);
  const [gusSuccess, setGusSuccess] = useState(false);

  // Highlight missing fields after a failed generate attempt
  const [highlightMissing, setHighlightMissing] = useState<string[]>([]);

  // Resulting URLs after successful generation
  const [generatedUrls, setGeneratedUrls] = useState<{ termsUrl: string; privacyUrl: string } | null>(null);

  // ---- Form state: manual URL fields ----
  const [urlForm, setUrlForm] = useState({
    terms_of_service_url: '',
    privacy_policy_url: '',
  });

  // ---- Form state: company data fields ----
  const [companyForm, setCompanyForm] = useState({
    legal_form: '' as LegalFormValue | '',
    company_legal_name: '',
    nip: '',
    regon: '',
    krs: '',
    company_street: '',
    company_building_no: '',
    company_flat_no: '',
    company_city: '',
    company_postal: '',
    company_phone: '',
    complaints_email: '',
    is_vat_exempt: false,
    is_micro_enterprise: false,
    has_dpo: false,
    dpo_contact: '',
  });

  // Load shop config on mount
  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const data = await getMyShopConfig();
        if (cancelled) return;
        if (data) {
          setConfig(data);
          setUrlForm({
            terms_of_service_url: data.terms_of_service_url || '',
            privacy_policy_url: data.privacy_policy_url || '',
          });
          setCompanyForm({
            legal_form: (data.legal_form as LegalFormValue) || '',
            company_legal_name: data.company_legal_name || '',
            nip: data.nip || '',
            regon: data.regon || '',
            krs: data.krs || '',
            company_street: data.company_street || '',
            company_building_no: data.company_building_no || '',
            company_flat_no: data.company_flat_no || '',
            company_city: data.company_city || '',
            company_postal: data.company_postal || '',
            company_phone: data.company_phone || '',
            complaints_email: data.complaints_email || '',
            is_vat_exempt: data.is_vat_exempt ?? false,
            is_micro_enterprise: data.is_micro_enterprise ?? false,
            has_dpo: data.has_dpo ?? false,
            dpo_contact: data.dpo_contact || '',
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[LegalDocumentsSettings] Failed to load shop config:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the effective legal-doc URL provenance (db / env / default) and
  // refresh whenever config changes (after a manual save or a generate), so the
  // panel surfaces an env fallback instead of rendering an empty DB column.
  useEffect(() => {
    let cancelled = false;
    getMyLegalDocsSource()
      .then((src) => { if (!cancelled) setLegalSource(src); })
      .catch((error) => {
        console.error('[LegalDocumentsSettings] Failed to load legal docs source:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // ---- Handler: save manual URL fields ----
  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updates: Partial<ShopConfig> = {
        terms_of_service_url: urlForm.terms_of_service_url || null,
        privacy_policy_url: urlForm.privacy_policy_url || null,
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
      console.error('[LegalDocumentsSettings] Error saving URLs:', error);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  // ---- Handler: save company data ----
  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCompany(true);
    setHighlightMissing([]);
    try {
      const updates: Partial<ShopConfig> = {
        legal_form: (companyForm.legal_form as LegalFormValue) || null,
        company_legal_name: companyForm.company_legal_name || null,
        nip: companyForm.nip || null,
        regon: companyForm.regon || null,
        krs: companyForm.krs || null,
        company_street: companyForm.company_street || null,
        company_building_no: companyForm.company_building_no || null,
        company_flat_no: companyForm.company_flat_no || null,
        company_city: companyForm.company_city || null,
        company_postal: companyForm.company_postal || null,
        company_phone: companyForm.company_phone || null,
        complaints_email: companyForm.complaints_email || null,
        // is_vat_exempt is edited in Payments → Taxes (single source of truth); shown read-only here.
        is_micro_enterprise: companyForm.is_micro_enterprise,
        has_dpo: companyForm.has_dpo,
        dpo_contact: companyForm.has_dpo ? (companyForm.dpo_contact || null) : null,
      };
      const success = await updateShopConfig(updates);
      if (success) {
        toast.success(t('saveCompanySuccess'));
        const newConfig = await getMyShopConfig();
        if (newConfig) setConfig(newConfig);
      } else {
        toast.error(t('saveCompanyError'));
      }
    } catch (error) {
      console.error('[LegalDocumentsSettings] Error saving company data:', error);
      toast.error(t('saveCompanyError'));
    } finally {
      setSavingCompany(false);
    }
  };

  // ---- Handler: fetch company data from GUS by NIP ----
  const handleGusFetch = async () => {
    setGusError(null);
    setGusSuccess(false);

    const validation = validateTaxId(companyForm.nip, true);
    if (!validation.isValid || !validation.isPolish || !validation.normalized) {
      setGusError(t('gusInvalidNip'));
      return;
    }

    setIsLoadingGus(true);
    try {
      const result = await lookupCompanyByNip(validation.normalized);
      if (result.ok) {
        const data = result.data;
        setCompanyForm((prev) => ({
          ...prev,
          company_legal_name: data.nazwa || prev.company_legal_name,
          company_street: data.ulica || prev.company_street,
          company_building_no: data.nrNieruchomosci || prev.company_building_no,
          company_flat_no: data.nrLokalu || prev.company_flat_no,
          company_city: data.miejscowosc || prev.company_city,
          company_postal: data.kodPocztowy || prev.company_postal,
          regon: data.regon || prev.regon,
        }));
        setGusSuccess(true);
      } else if (result.code === 'rate_limit') {
        setGusError(t('gusRateLimitError'));
      } else if (result.code === 'not_found') {
        setGusError(t('gusNotFound'));
      } else if (result.code === 'not_configured') {
        // Silent fail - GUS not configured, user can enter data manually.
        setGusError(null);
      } else if (result.code === 'security') {
        setGusError(t('gusSecurityError'));
      } else {
        setGusError(t('gusFetchError'));
      }
    } finally {
      setIsLoadingGus(false);
    }
  };

  // ---- Handler: generate & publish ----
  const handleGenerate = async () => {
    setGenerating(true);
    setHighlightMissing([]);
    setGeneratedUrls(null);

    try {
      const res = await fetch('/api/legal/generate', { method: 'POST' });
      const json: GenerateResponse = await res.json();

      if (json.ok) {
        setGeneratedUrls({ termsUrl: json.termsUrl, privacyUrl: json.privacyUrl });
        // Update URL form so the user sees the new URLs without reloading
        setUrlForm({ terms_of_service_url: json.termsUrl, privacy_policy_url: json.privacyUrl });
        if (json.warning === 'url_save_failed') {
          toast.warning(t('generateWarningUrlSaveFailed'));
        } else {
          toast.success(t('generateSuccess'));
        }
        // Refresh config so is_vat_exempt etc. stay in sync
        const newConfig = await getMyShopConfig();
        if (newConfig) setConfig(newConfig);
      } else {
        if (res.status === 422 && json.error === 'missing_fields' && json.missing) {
          setHighlightMissing(json.missing);
          const fieldLabels = json.missing.map((f) => t(MISSING_FIELD_KEYS[f] as Parameters<typeof t>[0] ?? ('missingFieldName' as Parameters<typeof t>[0]))).join(', ');
          toast.error(t('generateErrorMissingFields', { fields: fieldLabels }));
        } else if (res.status === 429) {
          toast.error(t('generateErrorRateLimit'));
        } else if (res.status === 403 || res.status === 401) {
          toast.error(t('generateErrorForbidden'));
        } else if (json.error === 'render_failed') {
          toast.error(t('generateErrorRenderFailed'));
        } else if (json.error === 'storage_failed') {
          toast.error(t('generateErrorStorageFailed'));
        } else {
          toast.error(t('generateErrorUnknown'));
        }
      }
    } catch (error) {
      console.error('[LegalDocumentsSettings] Error generating documents:', error);
      toast.error(t('generateErrorUnknown'));
    } finally {
      setGenerating(false);
    }
  };

  // ---- Helpers ----
  const inputClass = (fieldKey?: string) => {
    const base =
      'w-full px-4 py-2 border-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent';
    if (fieldKey && highlightMissing.includes(fieldKey)) {
      return `${base} border-red-500`;
    }
    return `${base} border-sf-border-medium`;
  };

  const toggleClass = 'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sf-accent focus:ring-offset-2';

  // ---- Loading skeleton ----
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

  const hasGeneratedDocs =
    generatedUrls !== null ||
    Boolean(config?.terms_of_service_url) ||
    Boolean(config?.privacy_policy_url);

  const isPolishInstallation = config?.country === 'PL';

  return (
    <div className="space-y-6">
      {/* Poland-only gate — show notice when country is not PL */}
      {!isPolishInstallation && (
        <div className="bg-sf-base border-2 border-sf-border-medium p-6">
          <p className="text-sm text-sf-body">
            {t('notPolishInstallation')}
          </p>
        </div>
      )}

      {isPolishInstallation && (
      <>
      {/* ===== SECTION 1: Company data for document generation ===== */}
      <div className="bg-sf-base border-2 border-sf-border-medium p-6">
        <h2 className="text-xl font-semibold text-sf-heading mb-2">
          {t('companySection')}
        </h2>
        <p className="text-sm text-sf-body mb-6">{t('companySectionDesc')}</p>

        <form onSubmit={handleCompanySubmit} className="space-y-6">
          {/* Legal form select */}
          <div>
            <label htmlFor="legal-form" className="block text-sm font-medium text-sf-body mb-2">
              {t('legalFormLabel')}
            </label>
            <select
              id="legal-form"
              value={companyForm.legal_form}
              onChange={(e) => setCompanyForm({ ...companyForm, legal_form: e.target.value as LegalFormValue | '' })}
              className={inputClass('legalForm')}
            >
              <option value="">—</option>
              <option value="jdg">{t('legalFormJdg')}</option>
              <option value="spzoo">{t('legalFormSpzoo')}</option>
              <option value="fundacja">{t('legalFormFundacja')}</option>
              <option value="osoba_fizyczna">{t('legalFormOsobaFizyczna')}</option>
            </select>
          </div>

          {/* Company legal name */}
          <div>
            <label htmlFor="company-legal-name" className="block text-sm font-medium text-sf-body mb-2">
              {t('companyLegalNameLabel')}
            </label>
            <input
              id="company-legal-name"
              type="text"
              value={companyForm.company_legal_name}
              onChange={(e) => setCompanyForm({ ...companyForm, company_legal_name: e.target.value })}
              className={inputClass('name')}
              placeholder={t('companyLegalNamePlaceholder')}
            />
          </div>

          {/* NIP / REGON / KRS — 3 columns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="nip" className="block text-sm font-medium text-sf-body mb-2">
                {t('nipLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  id="nip"
                  type="text"
                  value={companyForm.nip}
                  onChange={(e) => {
                    setCompanyForm({ ...companyForm, nip: e.target.value });
                    setGusError(null);
                    setGusSuccess(false);
                  }}
                  className={inputClass()}
                  placeholder={t('nipPlaceholder')}
                  maxLength={10}
                />
                <button
                  type="button"
                  onClick={handleGusFetch}
                  disabled={isLoadingGus || !companyForm.nip}
                  className="shrink-0 px-3 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoadingGus ? t('gusFetching') : t('gusFetchButton')}
                </button>
              </div>
              {gusSuccess && (
                <p className="mt-1 text-xs text-sf-success">{t('gusDataLoaded')}</p>
              )}
              {gusError && (
                <p className="mt-1 text-xs text-sf-warning">⚠️ {gusError}</p>
              )}
            </div>
            <div>
              <label htmlFor="regon" className="block text-sm font-medium text-sf-body mb-2">
                {t('regonLabel')}
              </label>
              <input
                id="regon"
                type="text"
                value={companyForm.regon}
                onChange={(e) => setCompanyForm({ ...companyForm, regon: e.target.value })}
                className={inputClass()}
                placeholder={t('regonPlaceholder')}
                maxLength={14}
              />
            </div>
            <div>
              <label htmlFor="krs" className="block text-sm font-medium text-sf-body mb-2">
                {t('krsLabel')}
              </label>
              <input
                id="krs"
                type="text"
                value={companyForm.krs}
                onChange={(e) => setCompanyForm({ ...companyForm, krs: e.target.value })}
                className={inputClass()}
                placeholder={t('krsPlaceholder')}
                maxLength={10}
              />
            </div>
          </div>

          {/* Address row 1: street + building + flat */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label htmlFor="company-street" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyStreetLabel')}
              </label>
              <input
                id="company-street"
                type="text"
                value={companyForm.company_street}
                onChange={(e) => setCompanyForm({ ...companyForm, company_street: e.target.value })}
                className={inputClass('street')}
                placeholder={t('companyStreetPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="company-building-no" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyBuildingNoLabel')}
              </label>
              <input
                id="company-building-no"
                type="text"
                value={companyForm.company_building_no}
                onChange={(e) => setCompanyForm({ ...companyForm, company_building_no: e.target.value })}
                className={inputClass('buildingNo')}
                placeholder={t('companyBuildingNoPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="company-flat-no" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyFlatNoLabel')}
              </label>
              <input
                id="company-flat-no"
                type="text"
                value={companyForm.company_flat_no}
                onChange={(e) => setCompanyForm({ ...companyForm, company_flat_no: e.target.value })}
                className={inputClass()}
                placeholder={t('companyFlatNoPlaceholder')}
              />
            </div>
          </div>

          {/* Address row 2: city + postal */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-city" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyCityLabel')}
              </label>
              <input
                id="company-city"
                type="text"
                value={companyForm.company_city}
                onChange={(e) => setCompanyForm({ ...companyForm, company_city: e.target.value })}
                className={inputClass('city')}
                placeholder={t('companyCityPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="company-postal" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyPostalLabel')}
              </label>
              <input
                id="company-postal"
                type="text"
                value={companyForm.company_postal}
                onChange={(e) => setCompanyForm({ ...companyForm, company_postal: e.target.value })}
                className={inputClass('postal')}
                placeholder={t('companyPostalPlaceholder')}
              />
            </div>
          </div>

          {/* Phone + complaints email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-phone" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyPhoneLabel')}
              </label>
              <input
                id="company-phone"
                type="text"
                value={companyForm.company_phone}
                onChange={(e) => setCompanyForm({ ...companyForm, company_phone: e.target.value })}
                className={inputClass()}
                placeholder={t('companyPhonePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="complaints-email" className="block text-sm font-medium text-sf-body mb-2">
                {t('complaintsEmailLabel')}
              </label>
              <input
                id="complaints-email"
                type="email"
                value={companyForm.complaints_email}
                onChange={(e) => setCompanyForm({ ...companyForm, complaints_email: e.target.value })}
                className={inputClass()}
                placeholder={t('complaintsEmailPlaceholder')}
              />
            </div>
          </div>

          {/* Toggles: micro enterprise / DPO. VAT exemption is edited in
              Payments → Taxes (single source of truth) and mirrored read-only here. */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-sf-body">{t('isVatExemptLabel')}:</span>
              <span className="text-sm font-medium text-sf-heading">
                {companyForm.is_vat_exempt ? t('isVatExemptYes') : t('isVatExemptNo')}
              </span>
              <span className="text-xs text-sf-muted">{t('isVatExemptManagedIn')}</span>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={companyForm.is_micro_enterprise}
                onClick={() => setCompanyForm({ ...companyForm, is_micro_enterprise: !companyForm.is_micro_enterprise })}
                className={`${toggleClass} ${companyForm.is_micro_enterprise ? 'bg-sf-accent-bg' : 'bg-sf-border-medium'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${companyForm.is_micro_enterprise ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
              <span className="text-sm text-sf-body">{t('isMicroEnterpriseLabel')}</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={companyForm.has_dpo}
                onClick={() => setCompanyForm({ ...companyForm, has_dpo: !companyForm.has_dpo })}
                className={`${toggleClass} ${companyForm.has_dpo ? 'bg-sf-accent-bg' : 'bg-sf-border-medium'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${companyForm.has_dpo ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
              <span className="text-sm text-sf-body">{t('hasDpoLabel')}</span>
            </label>
          </div>

          {/* DPO contact — shown only when has_dpo */}
          {companyForm.has_dpo && (
            <div>
              <label htmlFor="dpo-contact" className="block text-sm font-medium text-sf-body mb-2">
                {t('dpoContactLabel')}
              </label>
              <input
                id="dpo-contact"
                type="text"
                value={companyForm.dpo_contact}
                onChange={(e) => setCompanyForm({ ...companyForm, dpo_contact: e.target.value })}
                className={inputClass()}
                placeholder={t('dpoContactPlaceholder')}
              />
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingCompany}
              className="px-6 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingCompany ? t('saving') : t('saveCompanyButton')}
            </button>
          </div>
        </form>
      </div>

      {/* ===== SECTION 2: Generate & Publish ===== */}
      <div className="bg-sf-base border-2 border-sf-border-medium p-6">
        <h2 className="text-xl font-semibold text-sf-heading mb-2">
          {t('generateSection')}
        </h2>
        <p className="text-sm text-sf-body mb-4">{t('generateSectionDesc')}</p>

        {/* Admin-only disclaimer banner — NOT part of generated documents */}
        <div className="mb-6 p-4 border-2 border-amber-400/40 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {t('generateDisclaimer')}
          </p>
        </div>

        {/* Generate button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="px-6 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating
              ? t('generating')
              : hasGeneratedDocs
                ? t('regenerateButton')
                : t('generateButton')}
          </button>
        </div>

        {/* Missing contact e-mail notice — the email field is in Shop Settings, not here */}
        {highlightMissing.includes('email') && (
          <div className="mb-4 p-4 border-2 border-red-400/60 bg-red-50 dark:bg-red-900/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              {t('missingEmailNotice')}
            </p>
          </div>
        )}

        {/* Show resulting URLs after successful generation */}
        {generatedUrls && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-400/40">
            <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-3">
              {t('generatedDocsTitle')}
            </p>
            <ul className="space-y-2 text-sm text-sf-body">
              <li>
                <span className="font-medium">Terms: </span>
                <a
                  href={generatedUrls.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sf-accent underline hover:no-underline break-all"
                >
                  {generatedUrls.termsUrl}
                </a>
              </li>
              <li>
                <span className="font-medium">Privacy: </span>
                <a
                  href={generatedUrls.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sf-accent underline hover:no-underline break-all"
                >
                  {generatedUrls.privacyUrl}
                </a>
              </li>
            </ul>
          </div>
        )}
      </div>
      </>
      )}

      {/* ===== SECTION 3: Manual URL overrides (existing) ===== */}
      <div className="bg-sf-base border-2 border-sf-border-medium p-6">
        <h2 className="text-xl font-semibold text-sf-heading mb-2">
          {t('title')}
        </h2>
        <p className="text-sm text-sf-body mb-6">
          {t('description')}
        </p>

        <form onSubmit={handleUrlSubmit} className="space-y-6">
          {/* Terms of Service URL */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label htmlFor="legal-terms-url" className="text-sm font-medium text-sf-body">
                {t('termsOfServiceUrl')}
              </label>
              {legalSource && (
                <SourceBadge source={legalSource.terms.source} envAlsoSet={!!legalSource.terms.envValue} />
              )}
            </div>
            <input
              id="legal-terms-url"
              type="url"
              value={urlForm.terms_of_service_url}
              onChange={(e) => setUrlForm({ ...urlForm, terms_of_service_url: e.target.value })}
              className="w-full px-4 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
              placeholder={t('termsPlaceholder')}
            />
            {legalSource?.terms.source === 'env' && legalSource.terms.envValue && (
              <p className="mt-1 text-xs text-sf-accent break-all">
                {t('envValueHint', { url: legalSource.terms.envValue })}
              </p>
            )}
            <p className="mt-1 text-xs text-sf-muted">
              {t('termsHelp')}
            </p>
          </div>

          {/* Privacy Policy URL */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label htmlFor="legal-privacy-url" className="text-sm font-medium text-sf-body">
                {t('privacyPolicyUrl')}
              </label>
              {legalSource && (
                <SourceBadge source={legalSource.privacy.source} envAlsoSet={!!legalSource.privacy.envValue} />
              )}
            </div>
            <input
              id="legal-privacy-url"
              type="url"
              value={urlForm.privacy_policy_url}
              onChange={(e) => setUrlForm({ ...urlForm, privacy_policy_url: e.target.value })}
              className="w-full px-4 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent"
              placeholder={t('privacyPlaceholder')}
            />
            {legalSource?.privacy.source === 'env' && legalSource.privacy.envValue && (
              <p className="mt-1 text-xs text-sf-accent break-all">
                {t('envValueHint', { url: legalSource.privacy.envValue })}
              </p>
            )}
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
    </div>
  );
}
