'use client';
/** Standalone admin surface; A1.8 supplies the private CSV route. @see messages.ts */
import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, RefreshCw, Wallet } from 'lucide-react';
import { reservePayout, markPayoutPaid, cancelPayout, adjustCommission } from '@/lib/affiliates/payouts/actions';
import { getPayoutChoices, previewPayout } from '@/lib/affiliates/payouts/reads';
import { reserveSchema, paidSchema, cancelSchema, adjustmentSchema } from '@/lib/affiliates/payouts/contracts';
import { parsePayoutAmount } from '@/lib/affiliates/payouts/display';
import { formatMinorDisplay } from '@/lib/affiliates/csv/formatter';
import PayoutPicker from '@/components/affiliates/payouts/PayoutPicker';
import { payoutMessages } from '@/components/affiliates/payouts/messages';
import type { FormEvent } from 'react';
import type { z } from 'zod';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { CommissionChoice, PayoutChoices, PayoutInfo, PreviewInfo } from '@/lib/affiliates/payouts/contracts';

interface Props { locale: 'en' | 'pl'; initialPayout?: PayoutInfo; download: (id: string, version: string) => void }
const empty: PayoutChoices = { members: [], currencies: [], payouts: [], commissions: [] };
export default function PayoutPanel({ locale, initialPayout, download }: Props) {
  const t = payoutMessages[locale];
  const [choices, setChoices] = useState(empty);
  const [member, setMember] = useState(initialPayout?.member_id ?? '');
  const [currency, setCurrency] = useState(initialPayout?.currency ?? 'PLN');
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<PreviewInfo>();
  const [payout, setPayout] = useState(initialPayout);
  const [commissionSearch, setCommissionSearch] = useState('');
  const [commission, setCommission] = useState<CommissionChoice>();
  const [cutoff, setCutoff] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const result = await getPayoutChoices({ search, commission_search: commissionSearch, ...(member ? { member_id: member } : {}) });
      if (!active) return;
      if (result.success && result.data) { setChoices(result.data); if (!member && !search && result.data.members.length === 1) setMember(result.data.members[0].id); }
      else { setMessage(t.error); setDiagnostic(result.errorCode ?? ''); }
      setLoading(false);
    }, search ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [member, search, commissionSearch, revision, t.error]);
  useEffect(() => {
    if (!member) return;
    let active = true;
    const now = new Date().toISOString();
    void previewPayout({ member_id: member, currency, cutoff: now }).then(r => { if (active) { setPreview(r.data); setCutoff(now); } });
    return () => { active = false; };
  }, [member, currency, revision]);
  const current = choices.payouts.find(p => p.member_id === member && p.currency === currency && p.status === 'reserved');
  const selected = payout?.member_id === member && payout.currency === currency ? payout : current;
  const partner = choices.members.find(m => m.id === member);
  const amount = (minor: string) => { const formatted = formatMinorDisplay(minor, currency); return `${formatted.success ? formatted.data.replace('.', locale === 'pl' ? ',' : '.') : '—'} ${currency}`; };
  const inputClass = 'mt-1 w-full min-w-0 rounded-md border border-sf-border bg-sf-input px-3 py-2 text-sm text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent';
  const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-md bg-sf-accent-bg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40';
  const field = (name: string, label: string, type = 'text', required = true, defaultValue?: string) => <label className="block min-w-0 text-sm font-medium">{label}<input name={name} type={type} required={required} maxLength={200} defaultValue={defaultValue} inputMode={name.includes('amount') ? 'decimal' : undefined} className={inputClass} /></label>;
  function refresh() { setCommission(undefined); setCommissionSearch(''); setPreview(undefined); setPayout(undefined); setRevision(v => v + 1); }
  async function run<T,>(schema: z.ZodType, input: unknown, fn: (value: unknown) => Promise<ActionResponse<T>>, done?: (data: T) => void) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) { setMessage(t.error); return; }
    setBusy(true); setMessage('');
    try { const r = await fn(parsed.data); if (r.success && r.data) { refresh(); done?.(r.data); setMessage(t.success); } else { setDiagnostic(r.errorCode ?? ''); setMessage(r.errorCode === '409' ? t.conflict : t.error); } }
    catch { setMessage(t.error); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>, operation: 'paid' | 'cancel' | 'adjust') {
    event.preventDefault();
    const form = new FormData(event.currentTarget), value = (key: string) => String(form.get(key) ?? '');
    const base = { payout_id: selected?.id, version: selected?.version };
    if (operation === 'cancel') void run(cancelSchema, { ...base, no_transfer: form.has('no_transfer'), reason: value('reason') }, cancelPayout, setPayout);
    else {
      const minor = parsePayoutAmount(value(operation === 'adjust' ? 'amount_minor' : 'bank_amount_minor'), currency);
      if (minor === null) { setMessage(t.invalidAmount); return; }
      if (operation === 'adjust') {
        const c = commission;
        void run(adjustmentSchema, { commission_id: c?.id, version: c?.version, amount_minor: minor, reason: value('reason'), evidence_reference: value('evidence_reference'), review_dispute: form.has('review_dispute') }, adjustCommission);
      } else void run(paidSchema, { ...base, currency, bank_reference: value('bank_reference'), invoice_reference: value('invoice_reference'), bank_amount_minor: minor, paid_at: new Date(value('paid_at')).toISOString(), full_settlement: form.has('full_settlement'), ...(value('reason') ? { reason: value('reason'), evidence_reference: value('evidence_reference') } : {}) }, markPayoutPaid, setPayout);
    }
  }
  return <section className="mx-auto max-w-6xl space-y-5 p-4 text-sf-body sm:p-8">
    <header className="flex items-start justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-sf-muted">Sellf · {t.eyebrow}</p><h1 className="text-2xl font-semibold tracking-tight text-sf-heading sm:text-3xl">{t.title}</h1><p className="mt-2 text-sm text-sf-muted">{t.subtitle}</p></div><Wallet className="mt-1 hidden size-7 text-sf-muted sm:block" /></header>
    <div className="flex flex-col gap-3 rounded-xl border border-sf-border bg-sf-base p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><PayoutPicker disabled={busy} label={t.member} emptyLabel={t.noResults} onSearch={setSearch} options={choices.members.map(m => ({ value: m.id, label: m.display_name + (m.status && m.status !== 'approved' ? ` · ${t.memberStatuses[m.status as keyof typeof t.memberStatuses]}` : '') }))} selectedValue={member} placeholder={t.search} onSelect={id => { if (id === member) { setSearch(''); return; } setMember(id); setChoices(c => ({ ...c, payouts: [], commissions: [] })); setPreview(undefined); setPayout(undefined); setCommission(undefined); setSearch(''); }} /></div>
      <label className="text-sm font-medium sm:w-28">{t.currency}<select disabled={busy} className={inputClass} value={currency} onChange={e => { setCurrency(e.target.value); setCommission(undefined); setPreview(undefined); setPayout(undefined); }}>{choices.currencies.map(c => <option key={c}>{c}</option>)}</select></label>
      <button type="button" disabled={busy || !member} onClick={refresh} className="inline-flex items-center justify-center gap-2 rounded-md border border-sf-border px-3 py-2.5 text-sm"><RefreshCw size={15} />{t.refresh}</button>
    </div>
    {message && <p role="status" className="rounded-lg border border-sf-border bg-sf-base p-3 text-sm">{message}</p>}
    {!member && <p className="py-8 text-center text-sf-muted">{loading ? t.loading : choices.members.length ? t.empty : t.noPartners}</p>}
    {member && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div className="overflow-hidden rounded-xl border border-sf-border bg-sf-base">
          <div className="p-5"><p className="text-sm text-sf-muted">{partner?.display_name} · {selected?.status === 'reserved' ? t.current : t.payable}</p><p className="mt-2 break-words text-4xl font-semibold tracking-tight text-sf-heading">{amount(selected?.status === 'reserved' ? selected.earnings_minor : preview?.payable_minor ?? '0')}</p></div>
          <dl className="grid grid-cols-3 gap-2 border-t border-sf-border px-5 py-4 text-sm">{(['earnings_minor', 'debt_offset_minor', 'held_minor'] as const).map((key, i) => <div key={key}><dt className="text-xs text-sf-muted">{[t.earnings, t.debt, t.held][i]}</dt><dd className="mt-1 font-medium tabular-nums text-sf-heading">{amount(preview?.[key] ?? '0')}</dd></div>)}</dl>
        </div>
        {selected?.status === 'reserved' ? <div className="space-y-4 rounded-xl border border-sf-border bg-sf-base p-5">
          {selected.needs_review && <p role="alert" className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">{t.review}</p>}
          <div><h2 className="font-semibold text-sf-heading">{t.transfer}</h2><p className="mt-1 text-sm text-sf-muted">{t.transferHelp}</p></div>
          <form key={selected.id + selected.version} onSubmit={e => submit(e, 'paid')}><fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">{field('bank_reference', t.bank)}{field('invoice_reference', t.invoice)}{field('bank_amount_minor', `${t.amount} (${currency})`, 'text', true, formatMinorDisplay(selected.earnings_minor, currency).success ? amount(selected.earnings_minor).split(' ')[0] : '')}{field('paid_at', t.date, 'date', true, new Date().toISOString().slice(0, 10))}
            {selected.needs_review && <>{field('reason', t.reason)}{field('evidence_reference', t.evidence)}</>}<label className="flex items-start gap-2 py-2 text-sm sm:col-span-2"><input className="mt-1" type="checkbox" name="full_settlement" required />{t.full}</label><button className={`${buttonClass} sm:col-span-2`}>{t.paid}<ArrowRight size={16} /></button></fieldset></form>
          <details className="border-t border-sf-border pt-3 text-sm"><summary className="cursor-pointer text-sf-muted">{t.cancel}</summary><p className="my-3">{t.cancelHelp}</p><form onSubmit={e => submit(e, 'cancel')} className="space-y-3">{field('reason', t.reason)}<label className="flex items-start gap-2"><input type="checkbox" name="no_transfer" required />{t.noTransfer}</label><button disabled={busy} className="rounded-md border border-sf-border px-3 py-2">{t.cancel}</button></form></details>
        </div> : <div className="space-y-3">{!preview?.available && <p className="text-sm text-sf-muted">{preview?.sync_required ? t.syncing : t.unavailable}</p>}<button className={buttonClass} disabled={busy || !preview?.available || !partner} onClick={() => void run(reserveSchema, { member_id: member, currency, cutoff, member_version: preview?.member_version, program_version: preview?.program_version, payee_reference: partner?.code }, reservePayout, setPayout)}>{t.reserve}<ArrowRight size={16} /></button></div>}
      </div>
      <aside className="min-w-0 space-y-5 rounded-xl border border-sf-border bg-sf-base p-5"><div><h2 className="font-semibold text-sf-heading">{t.csv}</h2><p className="mt-2 text-sm leading-relaxed text-sf-muted">{t.statement}</p><button type="button" className="mt-4 inline-flex items-center gap-2 rounded-md border border-sf-border px-3 py-2 text-sm font-medium disabled:opacity-40" disabled={busy || selected?.status !== 'reserved' || selected.needs_review} onClick={() => selected && download(selected.id, selected.version)}><ArrowDownToLine size={16} />CSV</button></div>
        <p className="border-t border-sf-border pt-4 text-sm text-sf-muted">{t.minimum}: {preview?.threshold_minor ? amount(preview.threshold_minor) : '—'}</p>
        <details className="border-t border-sf-border pt-4 text-sm"><summary className="cursor-pointer font-medium">{t.adjustment}</summary><p className="my-3 text-sf-muted">{t.correctionHelp}</p><PayoutPicker disabled={busy} label={t.commission} emptyLabel={t.noResults} onSearch={setCommissionSearch} options={[...choices.commissions, ...(commission && !choices.commissions.some(c => c.id === commission.id) ? [commission] : [])].filter(c => c.currency === currency).map(c => ({ value: c.id, label: `${c.product_name} · ${new Date(c.paid_at).toLocaleDateString(locale)}` }))} selectedValue={commission?.id ?? ''} onSelect={id => setCommission(choices.commissions.find(c => c.id === id) ?? commission)} /><form onSubmit={e => submit(e, 'adjust')} className="mt-3 space-y-3">{field('amount_minor', `${t.signedAmount} (${currency})`)}{field('reason', t.reason)}{field('evidence_reference', t.evidence)}<label className="flex items-start gap-2"><input type="checkbox" name="review_dispute" />{t.dispute}</label><button disabled={busy || !commission} className={buttonClass}>{t.adjust}</button></form></details>
      </aside>
    </div>}
    {!!choices.payouts.length && <div className="space-y-2"><h2 className="text-sm font-semibold">{t.history}</h2>{choices.payouts.filter(p => p.currency === currency).slice(0, 5).map(p => <div key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-sf-border px-4 py-3 text-sm"><span>{partner?.display_name ?? t.member}</span><span className="font-medium tabular-nums">{amount(p.earnings_minor)} · {p.status === 'paid' ? t.paidStatus : p.status === 'cancelled' ? t.cancelled : t.reserved}</span></div>)}</div>}
    {(selected || diagnostic) && <details className="text-xs text-sf-muted"><summary className="cursor-pointer">{t.technical}</summary><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify({ payout: selected?.id, version: selected?.version, code: diagnostic || undefined }, null, 2)}</pre></details>}
  </section>;
}
