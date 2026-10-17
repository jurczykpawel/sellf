'use client';

/** Independent affiliate settings for saved products/coupons. @see lib/affiliates/products/actions.ts */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import PayoutPicker from '@/components/affiliates/payouts/PayoutPicker';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { commissionRuleSchema } from '@/lib/affiliates/model';
import { bindAffiliateCoupon, createAffiliateRule, getAffiliateCoupon, getAffiliateProduct } from '@/lib/affiliates/products/actions';
import { productAffiliateMessages } from '@/components/affiliates/products/messages';
import type { AffiliateCouponInfo, AffiliateProductInfo } from '@/lib/affiliates/products/actions';

const inputClass = 'block w-full min-w-0 rounded border border-sf-border bg-sf-input px-3 py-2 text-sf-heading';
const buttonClass = 'max-w-full break-words rounded border border-sf-border px-3 py-2 text-sf-heading disabled:opacity-50 focus-visible:outline-2';
function decimalMinor(value: string, decimals: number): string | null {
  const match = /^(\d{1,19})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  return BigInt(match[1] + (match[2] ?? '').padEnd(decimals, '0')).toString();
}
function useCopy() { return productAffiliateMessages[useLocale() === 'pl' ? 'pl' : 'en']; }

interface AffiliateRuleEditorProps {
  productId: string; productType?: string; isRefundable?: boolean; refundPeriodDays?: number | null;
}
export function AffiliateRuleEditor(props: AffiliateRuleEditorProps): React.JSX.Element {
  const locale = useLocale();
  return <RuleEditor key={`${props.productId}:${locale}`} {...props} />;
}
function RuleEditor({ productId, productType, isRefundable, refundPeriodDays }: AffiliateRuleEditorProps): React.JSX.Element {
  const t = useCopy();
  const [info, setInfo] = useState<AffiliateProductInfo | null>(null);
  const [kind, setKind] = useState('percentage');
  const [amount, setAmount] = useState('20');
  const [currency, setCurrency] = useState('PLN');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const load = useCallback(() => {
    return getAffiliateProduct(productId).then(result => {
      if (!result.success || !result.data) { setMessage(t.error); return false; }
      setInfo(result.data);
      const rule = result.data.rule;
      setKind(rule?.fixed_minor != null ? 'fixed' : 'percentage');
      const decimals = rule?.fixed_minor != null && ['JPY', 'KRW'].includes(rule.currency ?? '') ? 0 : 2;
      const digits = (rule?.fixed_minor ?? String(rule?.percentage_bps ?? 2000)).padStart(decimals + 1, '0');
      const display = decimals === 0 ? digits : `${digits.slice(0, -2)}.${digits.slice(-2)}`;
      setAmount(t === productAffiliateMessages.pl ? display.replace('.', ',') : display);
      setCurrency(rule?.currency ?? result.data.product.currency ?? 'PLN'); setEnabled(rule?.enabled ?? false);
      return true;
    }).catch(() => { setMessage(t.error); return false; }).finally(() => { setBusy(false); });
  }, [productId, t]);
  function reload() {
    setBusy(true); setMessage(''); setInfo(null);
    return load();
  }
  useEffect(() => { void load(); }, [load]);
  const subscription = (productType ?? info?.product.product_type) === 'subscription';
  const unlimited = (isRefundable ?? info?.product.is_refundable) && (refundPeriodDays === undefined ? info?.product.refund_period_days : refundPeriodDays) === null;
  async function save() {
    const minor = decimalMinor(amount, kind === 'fixed' && ['JPY', 'KRW'].includes(currency) ? 0 : 2);
    const rule = commissionRuleSchema.safeParse(kind === 'fixed' ? { fixed_minor: minor, currency }
      : { percentage_bps: minor === null ? -1 : Number(minor) });
    if (!rule.success) { setMessage(t.invalid); return; }
    setBusy(true);
    try {
      const result = await createAffiliateRule({ product_id: productId, expected_revision: info?.rule?.revision ?? 0, enabled, rule: rule.data });
      if (result.success) { if (await reload()) setMessage(t.ruleSaved); }
      else setMessage(result.errorCode === 'CONFLICT' ? t.conflict : t.error);
    } catch { setMessage(t.error); } finally { setBusy(false); }
  }
  return <section className="min-w-0 break-words space-y-3 rounded-lg border border-sf-border bg-sf-raised p-4 text-sf-heading">
    <h4 className="font-medium">{t.title}</h4>
    {subscription ? <p>{t.subscription}</p> : <>
      <p className="text-sm text-sf-muted">{t.policy}</p>
      <p className="rounded border border-sf-border bg-sf-base p-3 text-sm">{t.ruleSaveHint}</p>
      {unlimited && <p role="note" className="rounded bg-sf-warning-soft px-3 py-2 text-sm text-sf-heading">{t.unlimited}</p>}
      <fieldset disabled={busy || !info} className="min-w-0 space-y-3">
        <label className="flex gap-2"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />{t.enabled}</label>
        <div className={`grid min-w-0 gap-3 ${kind === 'fixed' ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem]' : 'sm:grid-cols-2'}`}>
        <label className="block text-sm">{t.type}<select className={inputClass} value={kind} onChange={e => setKind(e.target.value)}><option value="percentage">{t.percentage}</option><option value="fixed">{t.fixed}</option></select></label>
        <label className="block text-sm">{kind === 'fixed' ? t.minor : t.bps}<input className={inputClass} inputMode="decimal" maxLength={24} value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} /></label>
        {kind === 'fixed' && <label className="block text-sm">{t.currency}<select className={inputClass} value={currency} onChange={e => setCurrency(e.target.value)}>
          {SUPPORTED_CURRENCY_CODES.map(code => <option key={code}>{code}</option>)}</select></label>}
        </div>
        <button type="button" className={`${buttonClass} bg-sf-accent-bg text-white`} onClick={() => void save()}>{t.ruleSave}</button>
      </fieldset>
    </>}
    <p role="status" className="break-words text-sm">{busy ? t.loading : message}</p>
    {message && message !== t.ruleSaved && <button type="button" disabled={busy} className={buttonClass} onClick={() => void reload()}>{t.reload}</button>}
  </section>;
}

export function AffiliateCouponEditor({ couponId }: { couponId?: string }): React.JSX.Element {
  const locale = useLocale();
  const t = useCopy();
  if (!couponId) return <section className="space-y-2 rounded-lg border border-sf-border bg-sf-raised p-4 text-sf-heading"><h3 className="font-semibold">{t.owner}</h3><p className="text-sm text-sf-body">{t.saveCouponFirst}</p></section>;
  return <CouponEditor key={`${couponId}:${locale}`} couponId={couponId} />;
}
function CouponEditor({ couponId }: { couponId: string }): React.JSX.Element {
  const t = useCopy();
  const [info, setInfo] = useState<AffiliateCouponInfo | null>(null);
  const [member, setMember] = useState('');
  const [selected, setSelected] = useState<{ value: string; label: string }>();
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const load = useCallback((cursor: string | null = null) => {
    return getAffiliateCoupon({ coupon_id: couponId, cursor }).then(result => {
      if (result.success && result.data) { setInfo(result.data); return true; }
      setMessage(t.error); return false;
    }).catch(() => { setMessage(t.error); return false; }).finally(() => { setBusy(false); });
  }, [couponId, t]);
  function reload() {
    setBusy(true); setMessage(''); setInfo(null); setMember(''); setSelected(undefined); setSearch(''); setSearching(false); generation.current++;
    return load();
  }
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    const timer = setTimeout(async () => {
      if (!active || current !== generation.current) return;
      setSearching(true);
      try {
        const result = await getAffiliateCoupon({ coupon_id: couponId, cursor: null, search });
        if (!active || current !== generation.current) return;
        if (result.success && result.data) {
          const page = result.data;
          setInfo(previous => previous ? { ...previous, members: page.members, next_cursor: page.next_cursor } : previous);
        } else setMessage(t.error);
      } catch { if (active && current === generation.current) setMessage(t.error); }
      finally { if (active && current === generation.current) setSearching(false); }
    }, 200);
    return () => { clearTimeout(timer); active = false; };
  }, [couponId, search, t]);
  async function more() {
    if (!info?.next_cursor) return;
    const current = generation.current;
    setSearching(true);
    try {
      const result = await getAffiliateCoupon({ coupon_id: couponId, cursor: info.next_cursor, search });
      if (current !== generation.current) return;
      if (result.success && result.data) {
        const page = result.data;
        setInfo(previous => previous ? { ...previous, members: [...previous.members, ...page.members], next_cursor: page.next_cursor } : previous);
      } else setMessage(t.error);
    } catch { if (current === generation.current) setMessage(t.error); } finally { if (current === generation.current) setSearching(false); }
  }
  async function save() {
    if (!info || !member) return;
    setBusy(true);
    try {
      const result = await bindAffiliateCoupon({ coupon_id: couponId, member_id: member, expected_version: info.binding?.version ?? '0' });
      if (result.success) { if (await reload()) setMessage(t.couponAssigned); }
      else setMessage(result.errorCode === 'CONFLICT' ? t.conflict : result.errorCode === 'INVALID_INPUT' ? t.invalidOwner : t.error);
    } catch { setMessage(t.error); } finally { setBusy(false); }
  }
  return <section className="min-w-0 break-words space-y-3 rounded-lg border border-sf-border bg-sf-raised p-4 text-sf-heading">
    <h3 className="font-semibold">{t.owner}</h3>
    <p className="text-sm text-sf-body">{t.ownerHint}</p>
    {info?.binding && <p className="break-all text-sm">{t.current}: <strong>{info.binding.display_name}</strong> ({info.binding.code})</p>}
    <PayoutPicker disabled={busy || !info} label={t.partner} emptyLabel={searching ? t.searching : t.noPartners}
      placeholder={t.choose} options={[...(info?.members ?? []).filter(m => m.id !== selected?.value).map(m => ({ value: m.id, label: `${m.display_name} (${m.code})` })), ...(selected ? [selected] : [])]}
      selectedValue={member} onSearch={setSearch} onSelect={value => { setMember(value); const choice = info?.members.find(m => m.id === value); if (choice) setSelected({ value, label: `${choice.display_name} (${choice.code})` }); }} />
    {info && !search && !info.members.length && <p className="text-sm text-sf-muted">{t.noPartners}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`${buttonClass} bg-sf-accent-bg text-white`} disabled={busy || !member} onClick={() => void save()}>{t.assign}</button>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void reload()}>{t.reload}</button>
      {info?.next_cursor && <button type="button" className={buttonClass} disabled={busy || searching} onClick={() => void more()}>{t.next}</button>}
    </div>
    <p role="status" className="break-words text-sm">{busy ? t.loading : searching ? t.searching : message}</p>
  </section>;
}
