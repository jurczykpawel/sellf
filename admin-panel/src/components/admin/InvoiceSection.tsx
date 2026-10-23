'use client';
/** Order invoice actions. @see lib/actions/invoicing.ts */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getInvoiceSettings, mutateInvoice } from '@/lib/actions/invoicing';
import type { InvoiceInfo } from '@/types/payment';

export default function InvoiceSection({ transactionId, status, invoice, onRefresh }: { transactionId: string; status: string; invoice?: InvoiceInfo | null; onRefresh?(): void }) {
  const t = useTranslations('invoicing');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [manual, setManual] = useState(false);
  useEffect(() => { getInvoiceSettings().then(r => setManual(Boolean(r.success && r.data?.provider !== 'none' && r.data?.mode === 'manual'))); }, []);
  async function run(action: 'issue' | 'corrected') {
    setBusy(true);
    try { const r = await mutateInvoice(transactionId, action); setMessage(t(r.success ? 'saved' : 'error')); if (r.success) onRefresh?.(); }
    catch { setMessage(t('error')); } finally { setBusy(false); }
  }
  return <section aria-label={t('title')} className="my-4 space-y-2">
    <h4 className="font-semibold">{t('title')}</h4>
    {invoice && <><p>{t(invoice.status)}</p>{invoice.view_url && <a className="underline" href={invoice.view_url} target="_blank" rel="noreferrer">{invoice.number}</a>}{invoice.error && <p>{invoice.error}</p>}</>}
    {(!invoice && manual && ['completed','partially_refunded','awaiting_payment'].includes(status) || invoice?.status === 'failed') && <button className="border p-2" disabled={busy || Boolean(invoice && invoice.attempts >= 5)} onClick={() => run('issue')}>{t(invoice ? 'retry' : 'issue')}</button>}
    {invoice?.status === 'issued' && ['refunded','cancelled'].includes(status) && <><p>{t('correctionHelp')}</p><button className="border p-2" disabled={busy} onClick={() => run('corrected')}>{t('correct')}</button></>}
    <p role="status">{message}</p>
  </section>;
}
