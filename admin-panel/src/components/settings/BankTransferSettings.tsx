'use client';
/** Transfer configuration with the canonical validator. @see lib/orders/bank-transfer-config.ts */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getBankTransferConfig, saveBankTransferConfig } from '@/lib/orders/bank-transfer-actions';
import { bankTransferConfigSchema } from '@/lib/orders/bank-transfer-config';
export default function BankTransferSettings() {
  const t = useTranslations('bankTransfer');
  const [form, setForm] = useState(bankTransferConfigSchema.parse({}));
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let active = true; getBankTransferConfig().then(r => {
    if (!active) return;
    if (r.success && r.data) { const { id: _id, ...values } = r.data; void _id; const parsed = bankTransferConfigSchema.safeParse(values); if (parsed.success) { setForm(parsed.data); setReady(true); } }
    else setMessage(t('error'));
  }).catch(() => { if (active) setMessage(t('error')); }); return () => { active = false; }; }, [t]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = bankTransferConfigSchema.safeParse(form);
    if (!parsed.success) { setMessage(t('invalid')); return; }
    setBusy(true);
    try { const r = await saveBankTransferConfig(parsed.data); setMessage(t(r.success ? 'saved' : 'error')); }
    catch { setMessage(t('error')); } finally { setBusy(false); }
  }
  return <section aria-label={t('title')} className="rounded-xl border border-sf-border p-6 space-y-4">
    <h2 className="text-xl font-semibold">{t('title')}</h2>
    <form onSubmit={save} className="space-y-4">
      {(['bank_transfer_enabled', 'bank_transfer_grant_access_on_placement'] as const).map(key => <label key={key} className="flex gap-2"><input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} />{t(key)}</label>)}
      {(['bank_account_holder', 'bank_account_number', 'bank_name', 'bank_transfer_title_template', 'bank_transfer_due_days', 'bank_transfer_max_unpaid_per_email'] as const).map(key => {
        const numeric = typeof form[key] === 'number';
        return <label key={key} className="block text-sm">{t(key)}<input className="mt-1 block w-full rounded-lg border border-sf-border bg-sf-input p-3" type={numeric ? 'number' : 'text'} min={numeric ? 1 : undefined} max={key === 'bank_transfer_due_days' ? 60 : numeric ? 100 : undefined} maxLength={key === 'bank_account_number' ? 64 : 200} value={form[key]} onChange={e => setForm({ ...form, [key]: numeric ? Number(e.target.value) : e.target.value })} /></label>;
      })}
      <p>{t('preview')}: {form.bank_transfer_title_template.replaceAll('{order_number}', '12345')}</p>
      <p className="text-sm text-sf-muted">{t('profileHelp')}</p>
      <button className="rounded-lg bg-sf-accent-bg text-sf-inverse px-4 py-2 disabled:opacity-50" disabled={!ready || busy}>{t('save')}</button>
      <p role="status">{message}</p>
    </form>
  </section>;
}
