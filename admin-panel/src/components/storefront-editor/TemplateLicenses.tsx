'use client';

/** Private key entry and background verification status. @see api/v1/templates/licenses */
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, KeyRound } from 'lucide-react';
import { editorButton, editorControl } from '@/components/storefront-editor/SlotEditor';
import type { SubmitEvent } from 'react';
import type { TemplateLicenseStatus } from '@/lib/storefront-templates/template-credentials';

const IDS = ['storefront-a', 'storefront-b', 'storefront-c'] as const;
export default function TemplateLicenses() {
  const t = useTranslations('templateLicenses');
  const id = useId();
  const [templateId, setTemplateId] = useState<string>(IDS[0]);
  const [token, setToken] = useState('');
  const [statuses, setStatuses] = useState<TemplateLicenseStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/v1/templates/licenses', { cache: 'no-store', signal });
      if (!response.ok) { if (!signal?.aborted) setMessage(t('failure')); return; }
      const data = await response.json(); if (!signal?.aborted) setStatuses(data.statuses);
    } catch { if (!signal?.aborted) setMessage(t('failure')); }
  }, [t]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => { void refresh(controller.signal); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const body = JSON.stringify({ templateId, token });
    if (new TextEncoder().encode(body).byteLength > 16384) { setMessage(t('limit')); setBusy(false); return; }
    try {
      const response = await fetch('/api/v1/templates/licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      setToken('');
      if (!response.ok) { setMessage(t('failure')); return; }
      setMessage(t('saved')); await refresh();
    } catch { setToken(''); setMessage(t('failure')); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-sf-border bg-sf-raised p-4 sm:p-5">
    <summary className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold text-sf-heading"><KeyRound size={18} aria-hidden="true" />{t('title')}<ChevronDown size={16} className="ml-auto shrink-0" aria-hidden="true" /></summary>
    <div className="mt-3 space-y-5">
      <p className="max-w-3xl text-sm text-sf-body">{t('description')}</p>
      <ul className="grid gap-2 sm:grid-cols-3" aria-label={t('statuses')}>
        {IDS.map(template => {
          const status = statuses.find(s => s.templateId === template);
          return <li key={template} className="rounded-lg border border-sf-border px-3 py-3 text-sm"><span className="font-medium text-sf-heading">{t(template)}</span><p className="mt-1 text-sf-body">{t(`states.${status?.state ?? 'unknown'}`)}</p></li>;
        })}
      </ul>
      <form onSubmit={save} className="grid items-end gap-3 sm:grid-cols-[minmax(140px,1fr)_2fr_auto]">
        <label htmlFor={`${id}-template`} className="space-y-2 text-sm font-medium"><span>{t('template')}</span><select id={`${id}-template`} className={editorControl} value={templateId} onChange={e => setTemplateId(e.target.value)}>{IDS.map(template => <option key={template} value={template}>{t(template)}</option>)}</select></label>
        <label htmlFor={`${id}-key`} className="min-w-0 space-y-2 text-sm font-medium"><span>{t('key')}</span><input id={`${id}-key`} className={editorControl} type="password" autoComplete="off" spellCheck={false} maxLength={16384} required value={token} onChange={e => setToken(e.target.value)} /></label>
        <button className={editorButton} disabled={busy || !token.trim()}>{busy ? t('saving') : t('save')}</button>
      </form>
      <p role="status" className="text-sm text-sf-body">{message}</p>
      <p className="text-xs text-sf-muted">{t('freshness')}</p>
    </div>
  </details>;
}
