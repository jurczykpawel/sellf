'use client';

/** Seller publishes the creator terms (separate from the partner terms). @see lib/affiliates/cocreator/actions.ts */
import { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getCreatorTerms, publishCreatorTerms } from '@/lib/affiliates/cocreator/actions';
import { creatorTermsPublishSchema } from '@/lib/affiliates/cocreator/model';
import { cocreatorMessages } from '@/components/affiliates/products/messages';
import type { CreatorTermsInfo } from '@/lib/affiliates/cocreator/model';

const fieldClass = 'block w-full min-w-0 rounded-lg border border-sf-border bg-sf-input px-3 py-2 text-sm text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent';
const primaryClass = 'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-sf-accent-bg px-3 py-2 text-sm font-medium text-sf-heading hover:bg-sf-accent-hover focus-visible:outline-2 focus-visible:outline-sf-accent disabled:cursor-default disabled:opacity-50';

export default function CreatorTermsSettings({ locale }: { locale: 'en' | 'pl' }) {
  const t = cocreatorMessages[locale]; const id = useId();
  const [terms, setTerms] = useState<CreatorTermsInfo | null>(null);
  const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''); const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    getCreatorTerms().then(result => {
      if (!active) return;
      if (result.success) setTerms(result.data ?? null); else { setNotice(t.error); setError(true); }
    }).catch(() => { if (active) { setNotice(t.error); setError(true); } }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [t]);
  async function save(form: FormData) {
    const parsed = creatorTermsPublishSchema.safeParse({ expected_version: terms?.terms_version ?? null, terms_version: form.get('terms_version'), terms: { en: form.get('en'), pl: form.get('pl') } });
    if (!parsed.success) { setNotice(t.invalid); setError(true); return; }
    setBusy(true);
    try {
      const result = await publishCreatorTerms(parsed.data);
      if (result.success && result.data) { setTerms(result.data); setNotice(t.termsSaved); setError(false); }
      else { setNotice(result.errorCode === 'CONFLICT' ? t.termsConflict : t.error); setError(true); }
    } catch { setNotice(t.error); setError(true); } finally { setBusy(false); }
  }
  return <details data-testid="creator-terms" className="min-w-0 rounded-xl border border-sf-border bg-sf-raised">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:outline-2 focus-visible:outline-sf-accent">
      <div className="min-w-0"><span id={`${id}-title`} className="font-semibold">{t.termsTitle}</span><p className="mt-1 text-sm text-sf-body">{t.termsHint}</p></div>
      <ChevronDown size={18} aria-hidden="true" />
    </summary>
    {loaded && <form key={terms?.terms_version ?? 'none'} aria-labelledby={`${id}-title`} action={save} className="grid min-w-0 gap-4 border-t border-sf-border p-4">
      {!terms && <p className="rounded-lg bg-sf-warning-soft p-3 text-sm text-sf-heading">{t.termsNone}</p>}
      <label className="grid min-w-0 gap-1.5 text-sm font-medium">{t.termsVersion}<input className={fieldClass} name="terms_version" required maxLength={200} defaultValue={terms?.terms_version ?? ''} /></label>
      <label className="grid min-w-0 gap-1.5 text-sm font-medium">{t.termsEn}<textarea className={fieldClass} name="en" lang="en" required rows={4} defaultValue={terms?.terms.en ?? ''} /></label>
      <label className="grid min-w-0 gap-1.5 text-sm font-medium">{t.termsPl}<textarea className={fieldClass} name="pl" lang="pl" required rows={4} defaultValue={terms?.terms.pl ?? ''} /></label>
      <div><button className={primaryClass} disabled={busy}>{t.termsSave}</button></div>
    </form>}
    {notice && <p role={error ? 'alert' : 'status'} className={`m-4 rounded-lg p-3 text-sm ${error ? 'bg-sf-warning-soft' : 'bg-sf-success-soft'} text-sf-heading`}>{notice}</p>}
  </details>;
}
