'use client';

/** Co-creator share of a saved product (separate save, like the partner commission). @see lib/affiliates/cocreator/actions.ts */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { cocreatorRateSchema } from '@/lib/affiliates/cocreator/model';
import { getProductCocreator, removeProductCocreator, setProductCocreator } from '@/lib/affiliates/cocreator/actions';
import { formatMinorDisplay } from '@/lib/affiliates/csv/formatter';
import { currencyExponent, decimalMinor } from '@/lib/currency/minor-units';
import { cocreatorMessages } from '@/components/affiliates/products/messages';
import type { CocreatorInfo } from '@/lib/affiliates/cocreator/model';

type Info = CocreatorInfo & { product_type: string; product_currency: string };
const inputClass = 'block w-full min-w-0 rounded border border-sf-border bg-sf-input px-3 py-2 text-sf-heading';
const buttonClass = 'max-w-full break-words rounded border border-sf-border px-3 py-2 text-sf-heading disabled:opacity-50 focus-visible:outline-2';

export function CocreatorEditor({ productId, productType }: { productId: string; productType?: string }): React.JSX.Element {
  const locale = useLocale() === 'pl' ? 'pl' : 'en';
  return <Editor key={`${productId}:${locale}`} productId={productId} productType={productType} locale={locale} />;
}

function Editor({ productId, productType, locale }: { productId: string; productType?: string; locale: 'en' | 'pl' }): React.JSX.Element {
  const t = cocreatorMessages[locale];
  const id = React.useId();
  const [info, setInfo] = useState<Info | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percentage' | 'fixed'>('percentage');
  const [amount, setAmount] = useState('10');
  const [currency, setCurrency] = useState('PLN');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [programRequired, setProgramRequired] = useState(false);
  const load = useCallback(() => getProductCocreator(productId).then(result => {
    if (!result.success || !result.data) { setMessage(t.error); return false; }
    setInfo(result.data);
    setProgramRequired(!result.data.program_configured);
    setCurrency(result.data.cocreator?.currency ?? result.data.product_currency ?? 'PLN');
    return true;
  }).catch(() => { setMessage(t.error); return false; }).finally(() => setBusy(false)), [productId, t]);
  useEffect(() => { void load(); }, [load]);
  function reload() { setBusy(true); setMessage(''); return load(); }
  function failure(code?: string) {
    if (code === 'PROGRAM_REQUIRED') { setProgramRequired(true); return t.programRequired; }
    return code === 'ACCOUNT_NOT_FOUND' ? t.accountNotFound : code === 'CONFLICT' ? t.conflict : code === 'INVALID_INPUT' ? t.invalid : t.error;
  }
  async function save() {
    const minor = decimalMinor(amount, kind === 'fixed' ? currencyExponent(currency) : 2);
    const rule = cocreatorRateSchema.safeParse(kind === 'fixed' ? { fixed_minor: minor, currency } : { percentage_bps: minor === null ? -1 : Number(minor) });
    if (!rule.success || !email.trim()) { setMessage(t.invalid); return; }
    setBusy(true);
    try {
      const result = await setProductCocreator({ product_id: productId, expected_revision: info?.revision ?? 0, email: email.trim(),
        ...(name.trim() ? { display_name: name.trim() } : {}), rule: rule.data });
      if (result.success) { setEmail(''); setName(''); if (await reload()) setMessage(t.saved); }
      else setMessage(failure(result.errorCode));
    } catch { setMessage(t.error); } finally { setBusy(false); }
  }
  async function remove() {
    if (!info) return;
    setBusy(true);
    try {
      const result = await removeProductCocreator({ product_id: productId, expected_revision: info.revision });
      if (result.success) { if (await reload()) setMessage(t.removed); } else setMessage(failure(result.errorCode));
    } catch { setMessage(t.error); } finally { setBusy(false); }
  }
  const current = info?.cocreator;
  const subscription = (productType ?? info?.product_type) === 'subscription';
  const share = current && (current.percentage_bps !== null ? `${(current.percentage_bps / 100).toLocaleString(locale)}%` : (() => {
    const formatted = formatMinorDisplay(current.fixed_minor ?? '0', current.currency ?? '');
    return `${formatted.success ? (locale === 'pl' ? formatted.data.replace('.', ',') : formatted.data) : current.fixed_minor} ${current.currency}`;
  })());
  return <section aria-labelledby={`${id}-title`} data-testid="cocreator-settings" className="min-w-0 break-words space-y-3 rounded-lg border border-sf-border bg-sf-raised p-4 text-sf-heading">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id={`${id}-title`} className="font-medium">{t.title}</h4>
      <span className="rounded border border-sf-border px-2 py-1 text-xs font-medium text-sf-muted">{t.saveLabel}</span>
    </div>
    {subscription ? <p>{t.subscription}</p> : <>
      <p className="text-sm text-sf-muted">{t.policy}</p>
      {programRequired && <p role="note" className="rounded bg-sf-warning-soft px-3 py-2 text-sm">{t.programRequired}{' '}
        <Link className="underline" href={`/${locale}/dashboard/affiliates`}>{t.programLink}</Link></p>}
      <div className="rounded border border-sf-border bg-sf-base p-3 text-sm" aria-live="polite">
        {current ? <>
          <p><span className="text-sf-muted">{t.current}:</span> <strong>{current.display_name}</strong>{current.email ? ` (${current.email})` : ''} · <strong>{share}</strong></p>
          <p className="text-sf-muted">{t.since}: <time dateTime={current.since}>{new Date(current.since).toLocaleString(locale === 'pl' ? 'pl' : 'en-GB')}</time></p>
          <p className={current.terms_accepted ? 'text-sf-muted' : 'text-sf-heading'}>{current.terms_accepted ? t.termsAccepted : t.termsPending}</p>
        </> : <p className="text-sf-muted">{t.none}</p>}
      </div>
      <fieldset disabled={busy || !info} className="min-w-0 space-y-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t.email}<input className={inputClass} type="email" autoComplete="off" maxLength={254} value={email} aria-describedby={`${id}-email-hint`} onChange={e => setEmail(e.target.value)} /></label>
          <label className="block text-sm">{t.displayName}<input className={inputClass} maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
        </div>
        <p id={`${id}-email-hint`} className="text-sm text-sf-muted">{t.emailHint}</p>
        <div className={`grid min-w-0 gap-3 ${kind === 'fixed' ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem]' : 'sm:grid-cols-2'}`}>
          <label className="block text-sm">{t.type}<select className={inputClass} value={kind} onChange={e => setKind(e.target.value === 'fixed' ? 'fixed' : 'percentage')}><option value="percentage">{t.percentage}</option><option value="fixed">{t.fixed}</option></select></label>
          <label className="block text-sm">{kind === 'fixed' ? t.minor : t.bps}<input className={inputClass} inputMode="decimal" maxLength={24} value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} /></label>
          {kind === 'fixed' && <label className="block text-sm">{t.currency}<select className={inputClass} value={currency} onChange={e => setCurrency(e.target.value)}>
            {SUPPORTED_CURRENCY_CODES.map(code => <option key={code}>{code}</option>)}</select></label>}
        </div>
        <div className="space-y-2 border-t border-sf-border pt-3">
          <p id={`${id}-save-hint`} className="text-sm text-sf-muted">{t.saveHint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-describedby={`${id}-save-hint`} className={`${buttonClass} bg-sf-base font-medium`} onClick={() => void save()}>{t.save}</button>
            {current && <button type="button" className={buttonClass} onClick={() => void remove()}>{t.remove}</button>}
          </div>
        </div>
      </fieldset>
    </>}
    <p role="status" className="break-words text-sm">{busy ? t.loading : message}</p>
    {message && message !== t.saved && message !== t.removed && <button type="button" disabled={busy} className={buttonClass} onClick={() => void reload()}>{t.reload}</button>}
  </section>;
}
