'use client';

/**
 * Shop setting "collect a different invoice recipient": OFF by default; when on,
 * the checkout invoice section offers "Invoice for another institution (recipient)", always with a NIP.
 *
 * @see src/lib/actions/invoice-recipient-config.ts
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getInvoiceRecipientSetting, setInvoiceRecipientSetting } from '@/lib/actions/invoice-recipient-config';

export default function InvoiceRecipientSettings() {
  const t = useTranslations('settings.invoiceRecipient');
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getInvoiceRecipientSetting().then(result => {
      if (!live) return;
      if (result.success) { setEnabled(result.data?.enabled === true); setReady(true); }
      else toast.error(t('error'));
    }).catch(() => toast.error(t('error')));
    return () => { live = false; };
  }, [t]);

  async function toggle() {
    const previous = enabled;
    setEnabled(!previous);
    setSaving(true);
    try {
      const result = await setInvoiceRecipientSetting(!previous);
      if (result.success) toast.success(t('saved'));
      else { setEnabled(previous); toast.error(t('error')); }
    } catch { setEnabled(previous); toast.error(t('error')); }
    finally { setSaving(false); }
  }

  return (
    <section className="bg-sf-base border-2 border-sf-border-medium p-6" aria-labelledby="invoice-recipient-title">
      <h2 id="invoice-recipient-title" className="text-xl font-semibold text-sf-heading mb-2">{t('title')}</h2>
      <p className="text-sm text-sf-body mb-4">{t('description')}</p>
      <label className="flex items-center gap-3 min-h-11 cursor-pointer">
        <input type="checkbox" id="invoiceRecipientEnabled" checked={enabled} disabled={!ready || saving} onChange={toggle} className="h-5 w-5 accent-sf-accent" />
        <span>{t('toggle')}</span>
      </label>
      <p className="text-sm text-sf-muted mt-3">{t('help')}</p>
    </section>
  );
}
