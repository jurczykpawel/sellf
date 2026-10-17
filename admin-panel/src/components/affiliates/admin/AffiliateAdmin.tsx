'use client';

/** Standalone seller forms; session actions own authorization. @see admin/actions.ts */
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Users, X } from 'lucide-react';
import { applyToProgram, getAcceptedTerms, getAdminOverview, updateMember, updateProgram } from '@/lib/affiliates/admin/actions';
import { applicationSchema, memberUpdateSchema, programUpdateSchema } from '@/lib/affiliates/admin/contracts';
import { AFFILIATE_PROGRAM_DEFAULTS } from '@/lib/affiliates/program-defaults';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import SyncWorkPanel from '@/components/affiliates/admin/SyncWorkPanel';
import CaptchaWidget from '@/components/captcha/CaptchaWidget';
import { affiliateAdminMessages } from '@/components/affiliates/admin/messages';
import { displayThreshold, parseThreshold } from '@/components/affiliates/admin/thresholds';
import type { ReactNode } from 'react';
import type { AdminOverview, AdminResult, ApplicationProgramInfo, MemberInfo, TermsInfo } from '@/lib/affiliates/admin/contracts';
import type { AffiliateAdminLocale } from '@/components/affiliates/admin/messages';

type Messages = typeof affiliateAdminMessages.en;
const fieldClass = 'block w-full min-w-0 rounded-lg border border-sf-border bg-sf-input px-3 py-2 text-sm text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent';
const controlClass = 'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-sf-border px-3 py-2 text-sm font-medium text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent disabled:cursor-default disabled:opacity-50';
const buttonClass = `${controlClass} hover:bg-sf-hover`;
const primaryClass = `${controlClass} border-transparent bg-sf-accent-bg hover:bg-sf-accent-hover`;
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid min-w-0 gap-1.5 text-sm font-medium text-sf-heading">{label}{children}</label>; }
function message(result: AdminResult<unknown>, t: Messages): string {
  return result.success ? t.success : result.errorCode === 'TERMS_VERSION_CONFLICT' ? t.newTermsVersion : result.status === 409 ? t.conflict : result.status === 422 ? t.invalid : result.status === 429 ? t.limited : result.status === 401 ? t.unauthorized : result.status === 403 ? t.forbidden : t.error;
}
function Notice({ value, error }: { value: string; error: boolean }) { return value ? <p role={error ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${error ? 'bg-sf-warning-soft text-sf-heading' : 'bg-sf-success-soft text-sf-heading'}`}>{value}</p> : null; }
function statusLabel(status: string, t: Messages): string { return ({ pending: t.statePending, approved: t.stateApproved, rejected: t.stateRejected, suspended: t.stateSuspended, terminated: t.stateTerminated })[status] ?? t.error; }
function ThresholdFields({ initial, locale }: { initial: Record<string, string>; locale: AffiliateAdminLocale }) {
  const t = affiliateAdminMessages[locale], names = new Intl.DisplayNames([locale], { type: 'currency' });
  const [currencies, setCurrencies] = useState(Object.keys(initial)); const available = SUPPORTED_CURRENCY_CODES.filter(code => !currencies.includes(code)); const [selected, setSelected] = useState('');
  return <fieldset className="grid min-w-0 gap-3"><legend className="mb-3 font-semibold">{t.thresholds}</legend>
    {currencies.map(currency => <div key={currency} className="flex min-w-0 items-end gap-2">
      <div className="min-w-0 flex-1"><Field label={`${names.of(currency)} (${currency})`}><input className={fieldClass} name={`threshold_${currency}`} inputMode="decimal" required defaultValue={displayThreshold(initial[currency] ?? '0', currency)} /></Field></div>
      <button type="button" className={buttonClass} aria-label={`${t.remove} ${names.of(currency)}`} onClick={() => setCurrencies(current => current.filter(code => code !== currency))}><X aria-hidden="true" size={16} /></button>
    </div>)}
    {available.length > 0 && <div className="flex min-w-0 items-end gap-2"><div className="min-w-0 flex-1"><Field label={t.currency}><select className={fieldClass} value={selected || available[0]} onChange={event => setSelected(event.target.value)}>{available.map(code => <option key={code} value={code}>{names.of(code)} ({code})</option>)}</select></Field></div><button type="button" className={buttonClass} aria-label={t.addCurrency} onClick={() => { setCurrencies(current => [...current, selected || available[0]]); setSelected(''); }}><Plus aria-hidden="true" size={16} /></button></div>}
  </fieldset>;
}

export function AffiliateAdmin({ initial, locale }: { initial: AdminOverview; locale: AffiliateAdminLocale }) {
  const t = affiliateAdminMessages[locale]; const id = useId();
  const [overview, setOverview] = useState(initial); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState(false); const [filter, setFilter] = useState('');
  const report = (result: AdminResult<unknown>) => { setNotice(message(result, t)); setError(!result.success); };
  async function load(cursor?: string, status = filter) {
    setBusy(true);
    try { const result = await getAdminOverview({ ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) }); report(result); if (result.success && result.data) setOverview(result.data); }
    catch { report({ success: false, status: 500 }); } finally { setBusy(false); }
  }
  async function save(form: FormData) {
    setBusy(true);
    try {
      const thresholds: Record<string, string> = {};
      for (const [key, value] of form.entries()) if (key.startsWith('threshold_')) {
        const currency = key.slice(10), minor = parseThreshold(String(value), currency);
        if (minor === null) { setNotice(t.amountInvalid); setError(true); return; } thresholds[currency] = minor;
      }
      const parsed = programUpdateSchema.safeParse({ version: overview.program?.version ?? '0', enabled: form.get('enabled') === 'on', hold_days: Number(form.get('hold')), buffer_days: Number(form.get('buffer')), terms_version: form.get('terms_version'), terms: { en: form.get('en'), pl: form.get('pl') }, thresholds });
      if (!parsed.success) { report({ success: false, status: 422 }); return; }
      const result = await updateProgram(parsed.data); report(result); if (result.success && result.data) setOverview(current => ({ ...current, program: result.data! }));
    } catch { report({ success: false, status: 500 }); } finally { setBusy(false); }
  }
  const p = overview.program;
  return <section aria-labelledby={`${id}-title`} className="grid min-w-0 grid-cols-1 gap-6 text-sf-heading [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><h1 id={`${id}-title`} className="text-3xl font-semibold tracking-tight">{t.title}</h1><p className="mt-2 text-sm text-sf-body">{t.subtitle}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${p?.enabled ? 'bg-sf-success-soft' : 'bg-sf-hover'}`}>{p?.enabled ? t.enabled : t.disabled}</span></header>
    <details open={!p} className="min-w-0 rounded-xl border border-sf-border bg-sf-raised">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:outline-2 focus-visible:outline-sf-accent"><div className="min-w-0"><span className="font-semibold">{t.settings}</span><p className="mt-1 text-sm text-sf-body">{t.settingsHint}</p></div><ChevronDown size={18} aria-hidden="true" /></summary>
      <form key={p?.version ?? '0'} action={save} className="grid min-w-0 gap-6 border-t border-sf-border p-4 lg:grid-cols-2">
        <div className="grid min-w-0 content-start gap-5"><label className="flex items-center gap-3 text-sm font-medium"><input name="enabled" type="checkbox" defaultChecked={p?.enabled ?? AFFILIATE_PROGRAM_DEFAULTS.enabled} />{t.enabled}</label>
          <div><h2 className="font-semibold">{t.timing}</h2><p className="mt-1 text-sm text-sf-body">{t.timingHint}</p></div>
          <div className="grid min-w-0 grid-cols-2 items-end gap-3"><Field label={t.hold}><input className={fieldClass} name="hold" type="number" min={0} max={3650} required defaultValue={p?.hold_days ?? AFFILIATE_PROGRAM_DEFAULTS.hold_days} /></Field><Field label={t.buffer}><input className={fieldClass} name="buffer" type="number" min={0} max={365} required defaultValue={p?.buffer_days ?? AFFILIATE_PROGRAM_DEFAULTS.buffer_days} /></Field></div>
          <ThresholdFields initial={p?.thresholds ?? AFFILIATE_PROGRAM_DEFAULTS.thresholds} locale={locale} />
        </div>
        <div className="grid min-w-0 gap-4"><Field label={t.termsVersion}><input className={fieldClass} name="terms_version" required maxLength={200} defaultValue={p?.terms_version ?? ''} /></Field><p className="text-sm text-sf-body">{t.termsHint}</p>
          <Field label={t.termsEn}><textarea className={fieldClass} name="en" lang="en" required rows={4} defaultValue={p?.terms.en ?? ''} /></Field><Field label={t.termsPl}><textarea className={fieldClass} name="pl" lang="pl" required rows={4} defaultValue={p?.terms.pl ?? ''} /></Field>
        </div><div className="lg:col-span-2"><button className={primaryClass} disabled={busy}>{t.save}</button></div>
      </form>
    </details>
    <Notice value={notice} error={error} />
    <SyncWorkPanel locale={locale} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users size={20} aria-hidden="true" />{t.applications}</h2><div className="flex min-w-0 max-w-full flex-wrap gap-2"><label className="sr-only" htmlFor={`${id}-status`}>{t.status}</label><select id={`${id}-status`} className={`${fieldClass} !w-auto max-w-full`} value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); void load(undefined, event.target.value); }}><option value="">{t.all}</option>{['pending', 'approved', 'rejected', 'suspended', 'terminated'].map(status => <option key={status} value={status}>{statusLabel(status, t)}</option>)}</select><button type="button" className={buttonClass} disabled={busy} onClick={() => void load()}>{t.refresh}</button></div></div>
    {!overview.members.length && <p className="rounded-xl border border-dashed border-sf-border p-8 text-center text-sm text-sf-body">{t.empty}</p>}
    {overview.members.map(member => <MemberDecision key={`${member.id}-${member.version}`} member={member} locale={locale} onSaved={data => setOverview(current => ({ ...current, members: current.members.map(row => row.id === data.id ? data : row) }))} />)}
    {overview.next_cursor && <button className={buttonClass} disabled={busy} onClick={() => void load(overview.next_cursor!)}>{t.next}</button>}
  </section>;
}
function MemberDecision({ member, locale, onSaved }: { member: MemberInfo; locale: AffiliateAdminLocale; onSaved: (member: MemberInfo) => void }) {
  const t = affiliateAdminMessages[locale]; const [busy, setBusy] = useState(false); const [reason, setReason] = useState(''); const [notice, setNotice] = useState(''); const [error, setError] = useState(false); const [terms, setTerms] = useState<TermsInfo>();
  const [decision, setDecision] = useState<string | null>(null);
  const reasonInput = useRef<HTMLInputElement>(null), actionGroup = useRef<HTMLDivElement>(null), lastAction = useRef('');
  const validActions = member.status === 'pending' ? ['approved', 'rejected'] : member.status === 'approved' ? ['suspended', 'terminated'] : member.status === 'suspended' ? ['approved', 'terminated'] : [];
  const actionLabel = (status: string): string => status === 'approved' && member.status === 'suspended' ? t.restore : t[status as 'approved' | 'rejected' | 'suspended' | 'terminated'];
  useEffect(() => { if (decision) reasonInput.current?.focus(); else actionGroup.current?.querySelector<HTMLButtonElement>(`[data-status="${lastAction.current}"]`)?.focus(); }, [decision]);
  async function decide(status: string) {
    const parsed = memberUpdateSchema.safeParse({ member_id: member.id, version: member.version, status, reason: status === 'approved' ? (member.status === 'suspended' ? t.restoreReason : t.approvalReason) : reason });
    if (!parsed.success) { setNotice(t.reasonRequired); setError(true); return; }
    setBusy(true);
    try { const result = await updateMember(parsed.data); setNotice(message(result, t)); setError(!result.success); if (result.success && result.data) onSaved(result.data); }
    catch { setNotice(t.error); setError(true); } finally { setBusy(false); }
  }
  async function history() {
    setBusy(true);
    try { const result = await getAcceptedTerms(member.id); if (result.success && result.data) setTerms(result.data); else { setNotice(message(result, t)); setError(true); } }
    catch { setNotice(t.error); setError(true); } finally { setBusy(false); }
  }
  return <article aria-label={member.display_name} className="grid min-w-0 gap-4 rounded-xl border border-sf-border bg-sf-raised p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-lg font-semibold">{member.display_name}</h3><p className="mt-1 text-sm text-sf-body">{t.code}: <span className="font-medium">{member.code}</span></p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${member.status === 'approved' ? 'bg-sf-success-soft' : 'bg-sf-hover'}`}>{statusLabel(member.status, t)}</span></div>
    {member.channel && <p className="text-sm text-sf-body [overflow-wrap:anywhere]">{member.channel}</p>}
    {decision ? <form className="grid min-w-0 items-end gap-3 lg:grid-cols-[1fr_auto]" onSubmit={event => { event.preventDefault(); void decide(decision); }}>
      <Field label={t.reason}><input ref={reasonInput} className={fieldClass} value={reason} required maxLength={200} onChange={event => setReason(event.target.value)} /></Field>
      <div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy}>{actionLabel(decision)}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => { setDecision(null); setReason(''); setNotice(''); }}>{t.cancel}</button></div>
    </form> : <div ref={actionGroup} className="flex flex-wrap gap-2">{validActions.map(status => <button key={status} data-status={status} type="button" className={status === 'approved' ? primaryClass : buttonClass} disabled={busy} onClick={() => { if (status === 'approved') void decide(status); else { lastAction.current = status; setReason(''); setNotice(''); setDecision(status); } }}>{status === 'approved' && <Check size={16} aria-hidden="true" />}{actionLabel(status)}</button>)}</div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sf-border pt-3 text-xs text-sf-body"><time dateTime={member.accepted_at}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(member.accepted_at))}</time><button type="button" className="cursor-pointer rounded text-sm font-medium text-sf-accent underline-offset-4 hover:underline focus-visible:outline-2" disabled={busy} onClick={() => void history()}>{t.history}</button></div>
    {terms && <div className="rounded-lg bg-sf-base p-3"><p className="mb-2 text-xs text-sf-body">{t.termsVersion}: {terms.terms_version}</p><p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{terms.terms[locale]}</p></div>}<Notice value={notice} error={error} />
  </article>;
}
export function AffiliateApplication({ program, locale }: { program: ApplicationProgramInfo | null; locale: AffiliateAdminLocale }) {
  const t = affiliateAdminMessages[locale]; const id = useId(); const [token, setToken] = useState(''); const [reset, setReset] = useState(0); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  if (done || program?.applicationStatus) return <section className="mx-auto grid w-full min-w-0 max-w-2xl gap-4 rounded-xl border border-sf-border bg-sf-raised p-6 text-sf-heading [overflow-wrap:anywhere]">
    <h1 className="text-2xl font-semibold">{t.applicationReceived}</h1>
    <p role="status">{done || program?.applicationStatus === 'pending' ? t.pending : statusLabel(program!.applicationStatus!, t)}</p>
    <p className="text-sm text-sf-body">{t.applicationNext}</p>
    <Link href={`${locale === 'pl' ? '/pl' : ''}/my-affiliate`} className={`${primaryClass} min-w-0 max-w-full justify-self-start text-center`}>{t.viewApplication}</Link>
  </section>;
  if (!program?.enabled) return <p>{t.disabled}</p>;
  async function submit(form: FormData) {
    const parsed = applicationSchema.safeParse({ code: form.get('code'), display_name: form.get('display_name'), channel: form.get('channel'), terms_version: program!.terms_version, accepted: form.get('accepted') === 'on', captcha_token: token });
    setErrors({}); setNotice('');
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        next[field] = field === 'code' ? t.codeHint : field === 'accepted' ? t.acceptRequired : field === 'display_name' ? t.nameRequired : t.invalid;
      }
      setErrors(next);
      const first = formRef.current?.elements.namedItem(Object.keys(next)[0]);
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await applyToProgram(parsed.data); if (result.success) setDone(true); else setNotice(message(result, t));
    } catch { setNotice(t.error); } finally { setToken(''); setReset(value => value + 1); setBusy(false); }
  }
  return <section aria-labelledby={`${id}-title`} className="mx-auto grid w-full min-w-0 max-w-2xl gap-5 text-sf-heading"><header><h1 id={`${id}-title`} className="[overflow-wrap:anywhere] text-3xl font-semibold tracking-tight">{t.title}</h1><p className="mt-2 text-sm text-sf-body">{t.applicationHint}</p></header>
    <form ref={formRef} noValidate onSubmit={event => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className="grid min-w-0 gap-5 rounded-xl border border-sf-border bg-sf-raised p-5">
      <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2"><Field label={t.name}><input className={fieldClass} name="display_name" aria-invalid={!!errors.display_name} aria-describedby={errors.display_name ? `${id}-name-error` : undefined} required maxLength={120} /></Field>{errors.display_name && <p id={`${id}-name-error`} className="text-sm text-sf-danger">{errors.display_name}</p>}<div className="min-w-0"><Field label={t.code}><input className={fieldClass} name="code" aria-invalid={!!errors.code} aria-describedby={`${id}-code-hint`} required pattern="[a-z0-9_-]{3,40}" minLength={3} maxLength={40} /></Field><p id={`${id}-code-hint`} className={`mt-1 text-xs ${errors.code ? 'text-sf-danger' : 'text-sf-body'}`}>{t.codeHint}</p></div></div>
      <Field label={t.channel}><input className={fieldClass} name="channel" aria-invalid={!!errors.channel} aria-describedby={errors.channel ? `${id}-channel-error` : undefined} maxLength={500} /></Field>{errors.channel && <p id={`${id}-channel-error`} className="text-sm text-sf-danger">{errors.channel}</p>}
      <div className="rounded-lg border border-sf-border bg-sf-base p-4"><p className="mb-2 text-xs text-sf-body">{t.termsVersion}: {program.terms_version}</p><p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{program.terms[locale]}</p></div>
      <label className="flex items-center gap-3 text-sm font-medium"><input name="accepted" type="checkbox" aria-invalid={!!errors.accepted} aria-describedby={errors.accepted ? `${id}-accepted-error` : undefined} required />{t.accept}</label>{errors.accepted && <p id={`${id}-accepted-error`} className="text-sm text-sf-danger">{errors.accepted}</p>}
      <CaptchaWidget onVerify={setToken} onError={() => setToken('')} onTimeout={() => setToken('')} resetTrigger={reset} />
      <button className={primaryClass} disabled={busy || !token}>{t.apply}</button><Notice value={notice} error />
    </form></section>;
}
