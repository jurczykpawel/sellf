'use client';

/** The co-creator reads and accepts the current creator terms. @see lib/affiliates/cocreator/actions.ts */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptCreatorTerms } from '@/lib/affiliates/cocreator/actions';
import { cocreatorMessages } from '@/components/affiliates/products/messages';
import styles from './AffiliatePortal.module.css';

export default function CreatorTermsAccept({ terms, locale }: { terms: { version: string; en: string; pl: string }; locale: 'en' | 'pl' }) {
  const t = cocreatorMessages[locale]; const id = useId(); const router = useRouter();
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  async function accept() {
    setBusy(true); setNotice('');
    try {
      const result = await acceptCreatorTerms({ terms_version: terms.version, accepted: true });
      if (result.success) router.refresh();
      else setNotice(result.errorCode === 'CONFLICT' ? t.acceptConflict : t.acceptError);
    } catch { setNotice(t.acceptError); } finally { setBusy(false); }
  }
  return <form data-testid="creator-terms-accept" aria-labelledby={`${id}-title`} onSubmit={event => { event.preventDefault(); if (checked) void accept(); }} className={styles.card}>
    <h3 id={`${id}-title`}>{t.termsTitle}</h3>
    <p>{t.acceptHint}</p>
    <p><small>{t.termsVersion}: {terms.version}</small></p>
    <p style={{ whiteSpace: 'pre-wrap' }} lang={locale}>{terms[locale]}</p>
    <label style={{ display: 'flex', gap: '.5em', alignItems: 'center' }}><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{t.acceptLabel}</label>
    <button className={styles.button} type="submit" disabled={busy || !checked}>{t.acceptButton}</button>
    {notice && <p role="alert" className={styles.notice}>{notice}</p>}
  </form>;
}
