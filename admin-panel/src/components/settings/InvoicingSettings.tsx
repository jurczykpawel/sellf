'use client';
/** Invoice provider settings. @see lib/actions/invoicing.ts */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { checkInvoiceConnection, getInvoiceSettings, saveInvoiceSettings } from '@/lib/actions/invoicing';

export default function InvoicingSettings() {
  const t = useTranslations('invoicing');
  const [form, setForm] = useState({ provider: 'none', domain: '', mode: 'manual', exemption: '', template: '{product} {date} {session} {tier}', token: '' });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let active = true; getInvoiceSettings().then(r => {
    if (!active) return;
    if (r.success && r.data) { const { provider, domain, mode, exemption, template } = r.data; setForm({ provider, domain, mode, exemption, template, token: '' }); setReady(true); }
    else setMessage(t('error'));
  }).catch(() => { if (active) setMessage(t('error')); }); return () => { active = false; }; }, [t]);
  async function run(check: boolean) {
    setBusy(true);
    try {
      const saved = await saveInvoiceSettings(form);
      const result = saved.success && check ? await checkInvoiceConnection() : saved;
      setMessage(t(result.success ? check ? 'connected' : 'saved' : 'error'));
      if (saved.success) setForm(f => ({ ...f, token: '' }));
    } catch { setMessage(t('error')); }
    finally { setBusy(false); }
  }
  const field = (key: 'domain' | 'token' | 'exemption' | 'template') => <label className="block" key={key}>{t(key)}<input className="block w-full border border-sf-border p-2 bg-sf-base" type={key === 'token' ? 'password' : 'text'} autoComplete="off" value={form[key]} maxLength={key === 'template' ? 300 : 1000} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>;
  return <section aria-label={t('title')} className="space-y-4 border border-sf-border p-6">
    <h2 className="text-xl font-semibold">{t('title')}</h2>
    <label className="block">{t('provider')}<select aria-label={t('provider')} className="block" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}><option value="none">{t('none')}</option><option value="fakturownia">Fakturownia</option></select></label>
    {field('domain')}{field('token')}
    <p>{t('tokenHelp')}</p>
    <label className="block">{t('mode')}<select aria-label={t('mode')} className="block" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}><option value="manual">{t('manual')}</option><option value="auto">{t('auto')}</option></select></label>
    {field('exemption')}{field('template')}
    <p>{t('templateHelp')}</p>
    <button className="border p-2 mr-3" disabled={!ready || busy} onClick={() => run(false)}>{t('save')}</button>
    <button className="border p-2" disabled={!ready || busy || form.provider === 'none'} onClick={() => run(true)}>{t('check')}</button>
    <p role="status">{message}</p>
  </section>;
}
