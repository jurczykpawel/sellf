'use client';
/** Operator recovery controls. @see lib/affiliates/admin/actions.ts */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getAffiliateSyncOverview, retryAffiliateWork } from '@/lib/affiliates/admin/actions';
import { workRetrySchema } from '@/lib/affiliates/admin/contracts';
import { affiliateAdminMessages } from '@/components/affiliates/admin/messages';
import type { SyncOverview } from '@/lib/affiliates/admin/contracts';

export default function SyncWorkPanel({ locale }: { locale: 'en' | 'pl' }) {
  const t = affiliateAdminMessages[locale];
  const [data, setData] = useState<SyncOverview>();
  const [overdue, setOverdue] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0), [cursor, setCursor] = useState<string>();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void getAffiliateSyncOverview(cursor ? { cursor } : {}).then(result => {
      if (!active) return;
      if (result.success && result.data) {
        setData(result.data);
        setOverdue(!!result.data.oldest_pending_at && Date.now() - Date.parse(result.data.oldest_pending_at) > 15 * 60_000);
      } else setNotice(t.error);
    }).catch(() => { if (active) setNotice(t.error); });
    return () => { active = false; };
  }, [revision, cursor, t.error]);
  const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-sf-border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sf-accent disabled:opacity-50';
  async function retry(payment_id: string, generation: string) {
    const input = workRetrySchema.safeParse({ payment_id, generation, reason: reasons[payment_id] ?? '' });
    if (!input.success) { setNotice(t.reasonRequired); return; }
    setBusy(true); setNotice('');
    try {
      const result = await retryAffiliateWork(input.data);
      setNotice(result.success ? t.syncRetrySuccess : result.status === 409 ? t.conflict : t.error);
      if (result.success) { setReasons({}); setRevision(v => v + 1); }
    } catch { setNotice(t.error); } finally { setBusy(false); }
  }
  return <section aria-label={t.syncTitle} className="grid min-w-0 gap-4 rounded-xl border border-sf-border bg-sf-raised p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{t.syncTitle}</h2><p className="mt-1 max-w-2xl text-sm text-sf-body">{t.syncHint}</p></div><button type="button" className={buttonClass} disabled={busy} aria-label={`${t.refresh}: ${t.syncTitle}`} onClick={() => { setCursor(undefined); setRevision(v => v + 1); }}><RefreshCw size={16} aria-hidden="true" />{t.refresh}</button></header>
    {overdue && <p role="alert" className="rounded-lg bg-sf-warning-soft p-3 text-sm">{t.syncLag}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {data?.work.length === 0 && <p className="text-sm text-sf-body">{t.syncEmpty}</p>}
    {data?.work.map((work, index) => <form key={work.payment_id} aria-label={`${t.syncTitle} ${index + 1}`} className="grid min-w-0 gap-3 border-t border-sf-border pt-4" onSubmit={event => { event.preventDefault(); void retry(work.payment_id, work.requested_generation); }}>
      {work.payment && <p className="text-sm font-semibold">{work.payment.product?.name} · <time dateTime={work.payment.created_at}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(work.payment.created_at))}</time></p>}
      <p className="text-sm font-medium">{({ net_unavailable: t.syncNet, session_unresolved: t.syncSession, awaiting_fulfillment: t.syncWaiting })[work.last_error_code ?? ''] ?? t.syncFailed}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="grid min-w-0 flex-1 gap-1.5 text-sm">{t.syncReason}<input className="w-full min-w-0 rounded-lg border border-sf-border bg-sf-input px-3 py-2 focus-visible:outline-2 focus-visible:outline-sf-accent" required maxLength={200} value={reasons[work.payment_id] ?? ''} onChange={event => setReasons(current => ({ ...current, [work.payment_id]: event.target.value }))} /></label><button className={buttonClass} disabled={busy}>{t.syncRetry}</button></div>
      <details className="text-xs text-sf-body [overflow-wrap:anywhere]"><summary className="cursor-pointer">{t.syncTechnical}</summary><p className="mt-2">{work.payment_id} · {work.requested_generation} · {work.attempts} · {work.last_error_code}</p></details>
    </form>)}
    {data?.next_cursor && <button type="button" className={buttonClass} disabled={busy} onClick={() => setCursor(data.next_cursor!)}>{t.next}</button>}
  </section>;
}
