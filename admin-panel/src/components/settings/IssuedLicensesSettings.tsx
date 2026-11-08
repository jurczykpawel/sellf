'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Eye, RefreshCw, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { formatAdminDate } from '@/lib/timezone';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';
import { licenseEmailSchema } from '@/lib/license-keys/email';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';

interface FieldDefinition {
  id: string;
  type: 'text' | 'textarea' | 'email' | 'domain';
  label: string | { en?: string; pl?: string };
  required: boolean;
  max_length: number;
}

interface ProductOption {
  id: string;
  name: string;
  slug: string;
  license_tier: string | null;
  license_duration_days: number | null;
  custom_checkout_fields: FieldDefinition[] | null;
}

interface LicenseRow {
  id: string;
  product_id: string;
  email: string | null;
  order_id: string;
  kid: string;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_dispute_id: string | null;
  issuance_source: 'purchase' | 'manual' | 'api';
  license_domain: string | null;
  products: { name: string; slug: string; license_tier: string | null } | null;
}

const DOMAIN_FIELD = '_sellf_license_domain';

interface IssuedLicensesSettingsProps {
  enabled: boolean;
  /** Prefill from `/dashboard/licenses?email=&product=&q=` (order details link). */
  initialEmail?: string;
  initialProductId?: string;
  initialSearch?: string;
}

export default function IssuedLicensesSettings({ enabled, initialEmail = '', initialProductId = '', initialSearch = '' }: IssuedLicensesSettingsProps) {
  const t = useTranslations('settings.issuedLicenses');
  const locale = useLocale();
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [productId, setProductId] = useState(initialProductId);
  const [email, setEmail] = useState(initialEmail);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sendEmail, setSendEmail] = useState(true);
  const [search, setSearch] = useState(initialSearch.slice(0, 254));
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const limit = 20;

  const selectedProduct = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const domainField = selectedProduct?.custom_checkout_fields?.find(field => field.id === DOMAIN_FIELD && field.type === 'domain');
  const extraFields = useMemo(
    () => (selectedProduct?.custom_checkout_fields ?? []).filter((field) => field.id !== DOMAIN_FIELD),
    [selectedProduct],
  );

  const beginRequest = useLatestRequest(JSON.stringify([page, productId, search, source, status, enabled]));
  const fetchSettings = useCallback(async () => {
    const isCurrent = beginRequest();
    if (!isCurrent()) return;
    setLoading(true);

    try {
      const query = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search.trim()) query.set('search', search.trim());
      if (source) query.set('source', source);
      if (status) query.set('status', status);
      const response = await fetch(`/api/admin/licenses?${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('load');
      const body = await response.json();
      if (!isCurrent()) return;
      setLicenses(body.licenses);
      setProducts(body.products);
      setTotal(body.total);
      // A prefilled product that cannot issue licenses falls back to the first one that can.
      if (!body.products.some((p: ProductOption) => p.id === productId)) setProductId(body.products[0]?.id ?? '');
    } catch {
      if (isCurrent()) toast.error(t('loadError'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [page, productId, search, source, status, t, beginRequest]);

  const requestKey = JSON.stringify([page, productId, search, source, status, enabled]);
  const [previousKey, setPreviousKey] = useState(requestKey);
  if (previousKey !== requestKey) {
    setPreviousKey(requestKey);
    setLoading(true);
  }

  const load = useCallback(() => fetchSettings(), [fetchSettings]);

  useEffect(() => {
    if (enabled) void fetchSettings();
  }, [enabled, fetchSettings]);

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!licenseEmailSchema.safeParse(email).success) { setEmailError(t('invalidEmail')); document.getElementById('license-email')?.focus(); return; }
    setEmailError(null);
    if (domainField && ((domainField.required && !domain.trim()) || (domain.trim() && !normalizeLicenseDomain(domain)))) {
      setDomainError(t('invalidDomain'));
      document.getElementById('license-domain')?.focus();
      return;
    }
    setDomainError(null);
    if (!window.confirm(t('confirmIssue'))) return;
    setWorking(true);
    try {
      const response = await fetch('/api/admin/licenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, email, ...(domainField && domain.trim() ? { domain: domain.trim() } : {}), customFieldValues: values, sendEmail, locale: locale === 'pl' ? 'pl' : 'en' }),
      });
      const body = await response.json();
      if (!response.ok && (body.fieldErrors?.email || body.details?.fieldErrors?.email)) { setEmailError(t('invalidEmail')); return; }
      if (!response.ok && (body.fieldErrors?.domain || body.details?.fieldErrors?.domain || body.fieldErrors?.[DOMAIN_FIELD])) { setDomainError(t('invalidDomain')); return; }
      if (!response.ok) throw new Error(body.error || 'issue');
      setRevealed((current) => ({ ...current, [body.license.id]: body.license.token }));
      await navigator.clipboard.writeText(body.license.token);
      toast.success(t('issuedAndCopied'));
      setEmail('');
      setDomain('');
      setValues({});
      setPage(1);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('issueError'));
    } finally {
      setWorking(false);
    }
  };

  const reveal = async (id: string): Promise<string | null> => {
    if (revealed[id]) return revealed[id];
    if (!window.confirm(t('confirmReveal'))) return null;
    const response = await fetch(`/api/admin/licenses/${id}`, { cache: 'no-store' });
    if (!response.ok) { toast.error(t('revealError')); return null; }
    const body = await response.json();
    setRevealed((current) => ({ ...current, [id]: body.token }));
    return body.token;
  };

  const copy = async (id: string) => {
    const responseToken = revealed[id] ?? await reveal(id);
    if (responseToken) {
      await navigator.clipboard.writeText(responseToken);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  const revoke = async (id: string, keepRevoked = false) => {
    if (!window.confirm(t(keepRevoked ? 'confirmKeepRevoked' : 'confirmRevoke'))) return;
    const response = await fetch(`/api/admin/licenses/${id}`, { method: 'DELETE' });
    if (!response.ok) return toast.error(t('revokeError'));
    toast.success(t('revoked'));
    setRevealed((current) => { const next = { ...current }; delete next[id]; return next; });
    await load();
  };

  if (!enabled) return null;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
      <TutorialTrigger id="licenses" />

      <form data-tour="licenses-issue" onSubmit={issue} className="p-6 border-b-2 border-sf-border-medium space-y-4">
        <h3 className="font-semibold text-sf-heading">{t('manualTitle')}</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label={t('product')}><select required value={productId} onChange={(e) => { setProductId(e.target.value); setValues({}); setDomain(''); setDomainError(null); }} className="input"><option value="">{t('selectProduct')}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label={t('email')} error={emailError} errorId="license-email-error"><input id="license-email" required type="email" maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'license-email-error' : undefined} className="input" /></Field>
          {domainField && <Field label={t('domain')} error={domainError} errorId="license-domain-error"><input id="license-domain" aria-invalid={Boolean(domainError)} aria-describedby={domainError ? 'license-domain-error' : undefined} required={domainField.required} maxLength={253} placeholder="example.com" value={domain} onChange={(e) => { setDomain(e.target.value); setDomainError(null); }} className="input" /></Field>}
        </div>
        {selectedProduct && <p className="text-xs text-sf-muted">{t('policy', { tier: selectedProduct.license_tier ?? '—', days: selectedProduct.license_duration_days ?? t('unlimited') })}</p>}
        {extraFields.length > 0 && <div className="grid md:grid-cols-2 gap-4">{extraFields.map((field) => <Field key={field.id} label={labelFor(field.label)}><input required={field.required} type={field.type === 'email' ? 'email' : 'text'} maxLength={field.max_length} value={values[field.id] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))} className="input" /></Field>)}</div>}
        <label className="flex items-center gap-2 text-sm text-sf-body"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />{t('sendEmail')}</label>
        <div className="flex justify-end"><button disabled={working || !productId} className="px-5 py-2 bg-sf-accent-bg text-white font-medium disabled:opacity-50">{working ? t('issuing') : t('issue')}</button></div>
      </form>

      <div className="p-6 space-y-4">
        <div data-tour="licenses-filters" className="flex flex-wrap gap-3 items-end">
          <Field label={t('search')} error={searchError} errorId="license-search-error"><input maxLength={254} aria-invalid={Boolean(searchError)} aria-describedby={searchError ? 'license-search-error' : undefined} value={search} onChange={(e) => { const value = e.target.value; setSearchError(value.length > 254 ? t('searchTooLong') : null); setSearch(value.slice(0, 254)); setPage(1); }} className="input" /></Field>
          <Field label={t('source')}><select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className="input"><option value="">{t('all')}</option><option value="purchase">{t('purchase')}</option><option value="manual">{t('manual')}</option><option value="api">{t('api')}</option></select></Field>
          <Field label={t('status')}><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input"><option value="">{t('all')}</option><option value="active">{t('active')}</option><option value="expired">{t('expired')}</option><option value="revoked">{t('revokedStatus')}</option></select></Field>
          <button type="button" onClick={() => void load()} aria-label={t('refresh')} title={t('refresh')} className="p-2 border-2 border-sf-border-medium"><RefreshCw className="w-5 h-5" aria-hidden="true" /></button>
        </div>
        <div data-tour="licenses-table" className="overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="border-b border-sf-border text-left text-sf-muted">{['product','email','domain','tier','source','issued','expires','status','actions'].map((key) => <th key={key} className="p-2">{t(key)}</th>)}</tr></thead>
            <tbody>{licenses.map((license) => <tr key={license.id} className="border-b border-sf-border align-top">
              <td className="p-2 text-sf-heading">{license.products?.name ?? '—'}</td><td className="p-2">{license.email ?? '—'}</td><td className="p-2 font-mono text-xs">{license.license_domain ?? '—'}</td><td className="p-2">{license.products?.license_tier ?? '—'}</td><td className="p-2">{t(license.issuance_source)}</td><td className="p-2 whitespace-nowrap">{formatAdminDate(license.issued_at, locale, false)}</td><td className="p-2 whitespace-nowrap">{license.expires_at ? formatAdminDate(license.expires_at, locale, false) : t('unlimited')}</td><td className="p-2">{license.revoked_at ? t(license.revoked_by_dispute_id ? 'disputeRevokedStatus' : 'revokedStatus') : license.expires_at && new Date(license.expires_at) < new Date() ? t('expired') : t('active')}</td>
              <td className="p-2"><div className="flex gap-2"><button type="button" title={t('reveal')} onClick={() => void reveal(license.id)}><Eye className="w-4 h-4" /></button><button type="button" title={t('copy')} onClick={() => void copy(license.id)}>{copied === license.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>{(!license.revoked_at || license.revoked_by_dispute_id) && <button type="button" title={t(license.revoked_by_dispute_id ? 'keepRevoked' : 'revoke')} onClick={() => void revoke(license.id, Boolean(license.revoked_by_dispute_id))}><ShieldX className="w-4 h-4 text-sf-danger" /></button>}</div>{revealed[license.id] && <code className="block mt-2 max-w-56 truncate text-xs">{revealed[license.id]}</code>}</td>
            </tr>)}{!loading && licenses.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-sf-muted">{t('empty')}</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex justify-between items-center text-sm"><span>{t('total', { count: total })}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border disabled:opacity-40">{t('previous')}</button><span>{page}/{pages}</span><button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border disabled:opacity-40">{t('next')}</button></div></div>
      </div>
      <style jsx>{`.input{width:100%;border:2px solid var(--sf-border-medium);padding:.55rem .75rem;background:var(--sf-bg-input);outline:none}`}</style>
    </div>
  );
}

function Field({ label, children, error, errorId }: { label: string; children: React.ReactNode; error?: string | null; errorId?: string }) { return <label className="block text-sm text-sf-body min-w-44"><span className="block mb-1 font-medium">{label}</span>{children}{error && <span id={errorId} role="alert" className="block mt-1 text-xs text-sf-danger">{error}</span>}</label>; }
function labelFor(label: FieldDefinition['label']) { return typeof label === 'string' ? label : label.en || label.pl || 'Field'; }
