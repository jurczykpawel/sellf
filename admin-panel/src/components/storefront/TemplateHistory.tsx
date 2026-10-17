'use client';

/** History/diff controls delegate every operation to the session lifecycle. */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ValidationIssues from '@/components/storefront-editor/ValidationIssues';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateReadResult, TemplateDiffResult } from '@/lib/storefront-templates/lifecycle';
import type { StorefrontHistorySnapshot } from '@/lib/storefront-templates/repository';
import styles from './TemplateHistory.module.css';

export default function TemplateHistory() {
  const t = useTranslations('templatePreview'); const locale = useLocale();
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [current, setCurrent] = useState<TemplateReadResult | null>(null);
  const [history, setHistory] = useState<StorefrontHistorySnapshot[]>([]);
  const [diff, setDiff] = useState<TemplateDiffResult | null>(null);
  const [pending, setPending] = useState<{ revision: number; expectedRevision: number } | null>(null);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  function load(beforeRevision?: number) {
    return Promise.all([storefrontTemplateAction({ operation: 'read' }), storefrontTemplateAction({ operation: 'history', limit: 20, ...(beforeRevision === undefined ? {} : { beforeRevision }) })]).then(([read, page]) => {
      if (!read.success || !page.success) { setError(!read.success ? read.code : !page.success ? page.code : 'error'); return; }
      if ('data' in read && 'revision' in read.data && 'draft' in read.data) setCurrent(read.data);
      if ('data' in page && Array.isArray(page.data)) setHistory(previous => beforeRevision === undefined ? page.data as StorefrontHistorySnapshot[] : [...previous, ...page.data as StorefrontHistorySnapshot[]]);
    }).catch(() => { setError('error'); }).finally(() => { setBusy(false); });
  }
  function reload(beforeRevision?: number) {
    setBusy(true); setError(''); setPending(null); setValidation(null);
    return load(beforeRevision);
  }
  useEffect(() => { void load(); }, []);
  async function act(operation: 'diff' | 'rollback' | 'publish', revision: number, confirmed = false) {
    if (!current) return;
    setBusy(true); setError(''); setNotice(''); setValidation(null);
    try {
      let expectedRevision = current.revision;
      if (operation === 'publish' && revision !== current.revision && !confirmed) {
        setPending(null);
        const comparison = await storefrontTemplateAction({ operation: 'diff', fromRevision: current.revision, toRevision: revision });
        if (!comparison.success) { setError(comparison.code); return; }
        if ('data' in comparison && 'changes' in comparison.data) {
          setDiff(comparison.data); setPending({ revision, expectedRevision: current.revision });
        }
        return;
      }
      if (confirmed && (!pending || pending.revision !== revision || pending.expectedRevision !== current.revision)) {
        setPending(null); setError('CONFLICT'); return;
      }
      if (!confirmed) setPending(null);
      if (operation === 'publish' && revision !== current.revision) {
        const draft = history.find(row => row.revision === revision)?.draft;
        if (!draft) { setError('NOT_FOUND'); return; }
        const checked = await storefrontTemplateAction({ operation: 'validate', config: draft, mode: 'publish' });
        if (!checked.success) { setError(checked.code); setValidation(checked.validation); return; }
        if (!('data' in checked) || !('valid' in checked.data) || !checked.data.valid) {
          if ('data' in checked && 'errors' in checked.data) setValidation(checked.data);
          setError('data' in checked && 'errors' in checked.data && checked.data.errors.some(issue => issue.code === 'ENTITLEMENT') ? 'FORBIDDEN' : 'INVALID'); return;
        }
        const saved = await storefrontTemplateAction({ operation: 'draft', config: draft, expectedRevision });
        if (!saved.success) { setError(saved.code); setValidation(saved.validation); return; }
        if (!('revision' in saved)) { setError('error'); return; }
        expectedRevision = saved.revision;
        setPending(null); setNotice(t('draftReplaced'));
      }
      const response = await storefrontTemplateAction(operation === 'diff' ? { operation, fromRevision: revision, toRevision: current.revision } : operation === 'publish' ? { operation, expectedRevision } : { operation, targetRevision: revision, expectedRevision });
      if (!response.success) { await reload(); setError(response.code); setValidation(response.validation); return; }
      if ('data' in response && 'changes' in response.data) setDiff(response.data);
      if ('revision' in response) { setNotice(t('success', { revision: response.revision })); setDiff(null); await reload(); }
    } catch { setError('error'); } finally { setBusy(false); }
  }
  const [fixture, setFixture] = useState('standard'); const [previewLocale, setPreviewLocale] = useState(locale);
  const publishedRevision = history.find(row => row.draft === null)?.revision;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  function fieldLabel(path: string): string {
    return t(path.startsWith('/templateId') ? 'template' : path.startsWith('/content') ? 'content' : path.startsWith('/tokens') ? 'appearance' : path.startsWith('/settings') ? 'settings' : 'layout');
  }
  return <main className={styles.page} aria-busy={busy}>
    <a href={`${prefix}/dashboard/templates`} className={styles.back}>← {t('editor')}</a>
    <header className={styles.header}><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <button type="button" disabled={busy} onClick={() => { setDiff(null); void reload(); }} className={styles.secondary}>{t('reload')}</button>
    </header>
    {error && !validation?.errors.length && <p className={styles.error} role="alert">{t.has(error) ? t(error) : t('error')}</p>}
    {validation && <ValidationIssues issues={validation.errors} blocking />}
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
        </div>{current.draft ? <a className={styles.primary} href={`/template-preview/${current.revision}?locale=${previewLocale}&fixture=${fixture}`} target="_blank" rel="noreferrer">{t('preview')} <span aria-hidden="true">↗</span></a> : <p className={styles.help}>{t('noDraft')}</p>}</div>
      </section>
      <section aria-label={t('history')}>
        <h2 className={styles.heading}>{t('history')}</h2><p className={styles.help}>{t('historyHelp')}</p>
        <ol className={styles.list}>{history.map(row => <li key={row.revision} className={styles.row}>
          <div className={styles.entry}>
            <strong>{row.revision === publishedRevision ? t('publishedNow') : row.draft ? t('draft') : t('publish')}</strong>
            <div className={styles.meta}><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</time><span>· #{row.revision}</span></div>
          </div>
          <div className={styles.actions}>{row.revision !== current.revision && <button type="button" disabled={busy} className={styles.textButton} onClick={() => void act('diff', row.revision)}>{t('compare')}</button>}
          {row.revision !== publishedRevision && <button type="button" disabled={busy} className={styles.secondary} onClick={() => void act(row.draft ? 'publish' : 'rollback', row.revision)}>{t(row.draft ? 'publishVersion' : 'rollback')}</button>}</div>
        </li>)}</ol>
        {history.length > 0 && history.length % 20 === 0 && <button type="button" disabled={busy} className={styles.textButton} onClick={() => void reload(history.at(-1)!.revision)}>{t('more')}</button>}
      </section>
      {diff && <section className={styles.card} aria-label={t('changes')}>
        <h2 className={styles.heading}>{t('changes')} #{diff.fromRevision} → #{diff.toRevision}</h2>
        {!diff.changes.length && <p>{t('noChanges')}</p>}
        {diff.changes.map(change => <div key={change.path} className={styles.change}>
          <strong>{fieldLabel(change.path)}</strong><span>{t(change.kind)}</span>
          {change.path === '/templateId' && <p>{t(String(change.before))} → {t(String(change.after))}</p>}
          {change.path.startsWith('/content/') && typeof change.after === 'string' && <p>{change.after}</p>}
        </div>)}
        {pending && <div role="region" aria-label={t('confirmTitle')}>
          <h3>{t('confirmTitle')}</h3><p>{t('confirmHelp')}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void act('publish', pending.revision, true)}>{t('confirmPublish')}</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setPending(null); setDiff(null); }}>{t('cancel')}</button>
          </div>
        </div>}
        <details className={styles.technical}><summary>{t('technical')}</summary><pre>{JSON.stringify(diff, null, 2)}</pre></details>
      </section>}
    </>}
  </main>;
}
