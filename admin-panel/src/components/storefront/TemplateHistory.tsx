'use client';

/** History/diff controls delegate every operation to the session lifecycle. */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import type { TemplateReadResult, TemplateDiffResult } from '@/lib/storefront-templates/lifecycle';
import type { StorefrontHistorySnapshot } from '@/lib/storefront-templates/repository';
import styles from './TemplateHistory.module.css';

export default function TemplateHistory() {
  const t = useTranslations('templatePreview'); const locale = useLocale();
  const [current, setCurrent] = useState<TemplateReadResult | null>(null);
  const [history, setHistory] = useState<StorefrontHistorySnapshot[]>([]);
  const [diff, setDiff] = useState<TemplateDiffResult | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function load(beforeRevision?: number) {
    setBusy(true); setError('');
    try {
      const [read, page] = await Promise.all([storefrontTemplateAction({ operation: 'read' }), storefrontTemplateAction({ operation: 'history', limit: 20, ...(beforeRevision === undefined ? {} : { beforeRevision }) })]);
      if (!read.success || !page.success) { setError(!read.success ? read.code : !page.success ? page.code : 'error'); return; }
      if ('data' in read && 'revision' in read.data && 'draft' in read.data) setCurrent(read.data);
      if ('data' in page && Array.isArray(page.data)) setHistory(previous => beforeRevision === undefined ? page.data as StorefrontHistorySnapshot[] : [...previous, ...page.data as StorefrontHistorySnapshot[]]);
    } catch { setError('error'); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function act(operation: 'diff' | 'rollback', revision: number) {
    if (!current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await storefrontTemplateAction(operation === 'diff' ? { operation, fromRevision: revision, toRevision: current.revision } : { operation, targetRevision: revision, expectedRevision: current.revision });
      if (!response.success) { setError(response.code); return; }
      if ('data' in response && 'changes' in response.data) setDiff(response.data);
      if ('revision' in response) { setNotice(t('success', { revision: response.revision })); setDiff(null); await load(); }
    } catch { setError('error'); } finally { setBusy(false); }
  }
  const [fixture, setFixture] = useState('standard'); const [previewLocale, setPreviewLocale] = useState(locale);
  const prefix = locale === 'en' ? '' : `/${locale}`;
  function fieldLabel(path: string): string {
    return t(path.startsWith('/templateId') ? 'template' : path.startsWith('/content') ? 'content' : path.startsWith('/tokens') ? 'appearance' : path.startsWith('/settings') ? 'settings' : 'layout');
  }
  return <main className={styles.page} aria-busy={busy}>
    <a href={`${prefix}/admin/templates`} className={styles.back}>← {t('editor')}</a>
    <header className={styles.header}><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <button type="button" disabled={busy} onClick={() => { setDiff(null); void load(); }} className={styles.secondary}>{t('reload')}</button>
    </header>
    {error && <p className={styles.error} role="alert">{t.has(error) ? t(error) : t('error')}</p>}
    <p className={styles.status} role="status">{notice}</p>
    {current && <>
      <p className={styles.revision}>{t('revision')} <strong>{current.revision}</strong></p>
      <section aria-label={t('preview')} className={styles.card}>
        <h2 className={styles.heading}>{t('preview')}</h2><p className={styles.help}>{t('previewHelp')}</p>
        <div className={styles.preview}><div className={styles.controls}>
          <label>{t('fixture')} <select value={fixture} onChange={e => setFixture(e.target.value)}>
            {['standard', 'empty', 'long', 'unavailable', 'published-products'].map(id => <option key={id} value={id}>{t(id)}</option>)}
          </select></label>
          <label>{t('locale')} <select value={previewLocale} onChange={e => setPreviewLocale(e.target.value)}><option value="en">English</option><option value="pl">Polski</option></select></label>
        </div>{current.draft ? <a className={styles.primary} href={`${prefix}/admin/templates/preview?revision=${current.revision}&locale=${previewLocale}&fixture=${fixture}`} target="_blank" rel="noreferrer">{t('preview')} <span aria-hidden="true">↗</span></a> : <p className={styles.help}>{t('noDraft')}</p>}</div>
      </section>
      <section aria-label={t('history')}>
        <h2 className={styles.heading}>{t('history')}</h2><p className={styles.help}>{t('historyHelp')}</p>
        <ol className={styles.list}>{history.map(row => <li key={row.revision} className={styles.row}>
          <div className={styles.entry}><span className={styles.badge}>#{row.revision}</span><div>
            <strong>{t(row.operation === 'rollback' ? 'rollbackOperation' : row.operation)}</strong>
            <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(locale)}</time>
          </div></div>
          <div className={styles.actions}><button type="button" disabled={busy} className={styles.textButton} onClick={() => void act('diff', row.revision)}>{t('compare')}</button>
          <button type="button" disabled={busy} className={styles.secondary} onClick={() => void act('rollback', row.revision)}>{t('rollback')}</button></div>
        </li>)}</ol>
        {history.length > 0 && history.length % 20 === 0 && <button type="button" disabled={busy} className={styles.textButton} onClick={() => void load(history.at(-1)!.revision)}>{t('more')}</button>}
      </section>
      {diff && <section className={styles.card} aria-label={t('changes')}>
        <h2 className={styles.heading}>{t('changes')} #{diff.fromRevision} → #{diff.toRevision}</h2>
        {!diff.changes.length && <p>{t('noChanges')}</p>}
        {diff.changes.map(change => <div key={change.path} className={styles.change}>
          <strong>{fieldLabel(change.path)}</strong><span>{t(change.kind)}</span>
          {change.path === '/templateId' && <p>{t(String(change.before))} → {t(String(change.after))}</p>}
          {change.path.startsWith('/content/') && typeof change.after === 'string' && <p>{change.after}</p>}
        </div>)}
        <details className={styles.technical}><summary>{t('technical')}</summary><pre>{JSON.stringify(diff, null, 2)}</pre></details>
      </section>}
    </>}
  </main>;
}
