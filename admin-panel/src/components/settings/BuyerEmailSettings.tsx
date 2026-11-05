'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getMyShopConfig, updateShopConfig } from '@/lib/actions/shop-config';

export default function BuyerEmailSettings() {
  const t = useTranslations('settings.buyerEmails');
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    getMyShopConfig().then(config => {
      if (live) { setEnabled(config?.supabase_buyer_emails === true); setReady(true); }
    }).catch(() => { toast.error(t('error')); });
    return () => { live = false; };
  }, [t]);
  async function toggle() {
    setSaving(true);
    try {
      if (await updateShopConfig({ supabase_buyer_emails: !enabled })) {
        setEnabled(!enabled);
        toast.success(t('saved'));
      } else toast.error(t('error'));
    } catch { toast.error(t('error')); }
    finally { setSaving(false); }
  }
  return <section className="bg-sf-base border-2 border-sf-border-medium p-6" aria-labelledby="buyer-emails-title">
    <h2 id="buyer-emails-title" className="text-xl font-semibold text-sf-heading mb-2">{t('title')}</h2>
    <p className="text-sm text-sf-body mb-4">{t('description')}</p>
    <label className="flex items-center gap-3 min-h-11 cursor-pointer">
      <input type="checkbox" checked={enabled} disabled={!ready || saving} onChange={toggle} className="h-5 w-5 accent-sf-accent" />
      <span>{t('toggle')}</span>
    </label>
    <p className="text-sm text-sf-muted my-3">{t('warning')}</p>
    <a href="https://github.com/jurczykpawel/mailstack" target="_blank" rel="noopener noreferrer" className="text-sf-accent underline">{t('mailstack')}</a>
  </section>;
}
