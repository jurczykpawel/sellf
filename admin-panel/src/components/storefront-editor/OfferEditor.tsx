'use client';

/** Per-product authoring within the templates workspace. @see offer-lifecycle.ts */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Eye, History, RotateCcw } from 'lucide-react';
import { productOfferAction } from '@/lib/actions/storefront-templates';
import { DEFAULT_OFFER } from '@/lib/storefront-templates/offer';
import { validatePhase2 } from '@/lib/storefront-templates/phase2-contracts';
import BindingPicker from '@/components/storefront-editor/BindingPicker';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';
import { useTutorials } from '@/components/tutorials/TutorialProvider';
import SlotEditor, { editorButton, editorControl } from '@/components/storefront-editor/SlotEditor';
import type { OfferReadResult } from '@/lib/storefront-templates/offer-lifecycle';
import type { OfferPageConfig } from '@/lib/storefront-templates/offer-repository';

export default function OfferEditor({ initialProductId }: { initialProductId?: string }) {
  const t = useTranslations('offerEditor'); const shared = useTranslations('storefrontEditor');
  const locale = useLocale() === 'pl' ? 'pl' : 'en';
  const router = useRouter();
  const tutorials = useTutorials();
  const productId = initialProductId ?? '';
  const [snapshot, setSnapshot] = useState<OfferReadResult | null>(null);
  const [config, setConfig] = useState<OfferPageConfig>(structuredClone(DEFAULT_OFFER));
  const [section, setSection] = useState<'offer.hero' | 'offer.faq' | 'offer.closing'>('offer.hero');
  const [busy, setBusy] = useState(Boolean(productId)); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const load = useCallback((id: string, isCurrent: () => boolean = () => true) => {
    return productOfferAction({ operation: 'read', productId: id }).then(response => {
      if (!isCurrent()) return;
      if (!response.success) { setError(response.code); setSnapshot(null); return; }
      if ('data' in response && 'productName' in response.data) {
        setSnapshot(response.data); setConfig(structuredClone(response.data.draft ?? response.data.published ?? DEFAULT_OFFER)); setDirty(false); setConfirm(false);
      }
    }).catch(() => { if (isCurrent()) setError('UNAVAILABLE'); }).finally(() => { if (isCurrent()) setBusy(false); });
  }, []);
  function reload() {
    setBusy(true); setError('');
    return load(productId);
  }
  useEffect(() => {
    let active = true;
    if (productId) void load(productId, () => active);
    return () => { active = false; };
  }, [productId, load]);
  function edit(next: OfferPageConfig) { setConfig(next); setDirty(true); }
  async function save() {
    if (!snapshot) return;
    const validation = validatePhase2(config, 'offer-config');
    if (!validation.valid) {
      setError('INVALID');
      setTimeout(() => { const field = document.querySelector<HTMLElement>('[data-offer-editor] [aria-invalid="true"]'); field?.scrollIntoView?.({ block: 'center' }); field?.focus(); }, 0);
      return;
    }
    setBusy(true); setError('');
    try {
      const response = await productOfferAction({ operation: 'draft', productId, expectedRevision: snapshot.revision, config });
      if (response.success && 'revision' in response) { setSnapshot({ ...snapshot, revision: response.revision, draft: config, validation: response.validation }); setDirty(false); }
      else if (!response.success) setError(response.code);
    } catch { setError('UNAVAILABLE'); } finally { setBusy(false); }
  }
  const prefix = locale === 'pl' ? '/pl' : '';
  return <div data-offer-editor className="mx-auto max-w-6xl space-y-6 text-sf-heading">
    <header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1><p className="max-w-2xl text-sm text-sf-muted">{t('intro')}</p></header>
    {/* The tutorial starts on the product choice too and carries over to the chosen product's editor (W148-1). */}
    {!productId && <><TutorialTrigger id="offer-page" /><section data-tour="offer-product" className="rounded-2xl border border-sf-border bg-sf-base p-5"><BindingPicker label={t('chooseProduct')} kind="products" selectedIds={[]} maxItems={1} onChange={ids => { if (ids[0]) router.push(`?product=${ids[0]}${tutorials?.isRunning('offer-page') ? '&tutorial=offer-page' : ''}`); }} /></section></>}
    {error && <div role="alert" className="rounded-xl border border-sf-danger bg-sf-danger-soft p-4 text-sm">{t(error === 'CONFLICT' ? 'conflict' : error === 'INVALID' ? 'invalid' : 'failure')}</div>}
    {productId && !snapshot && <button type="button" className={editorButton} disabled={busy} onClick={() => void reload()}>{busy ? t('loading') : shared('reload')}</button>}
    {snapshot && <>
      <TutorialTrigger id="offer-page" />
      <div data-tour="offer-product" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sf-border bg-sf-base p-5"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-sf-muted">{t('product')}</p><h2 className="mt-1 break-words text-xl font-semibold">{snapshot.productName}</h2></div><a className={editorButton} href={`${prefix}/dashboard/templates?surface=offer`}>{t('changeProduct')}</a></div>
      <div data-tour="offer-savebar" className="sticky top-14 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sf-border bg-sf-base p-3 shadow-sm">
        <p role="status" className="flex items-center gap-2 text-sm text-sf-muted"><Check size={16} aria-hidden="true" />{busy ? shared('saving') : dirty ? shared('unsaved') : shared('savedState')}</p>
        <div className="flex gap-2"><button type="button" className={editorButton} aria-label={shared('reload')} disabled={busy} onClick={() => { if (dirty && !confirm) setConfirm(true); else void reload(); }}><RotateCcw size={17} aria-hidden="true" /></button><button type="button" className={`${editorButton} border-sf-accent bg-sf-accent-soft text-sf-accent`} disabled={busy || !dirty || error === 'CONFLICT'} onClick={save}>{shared('save')}</button></div>
      </div>
      {confirm && <div className="space-y-3 rounded-xl border border-sf-border p-4"><p>{shared('confirmReload')}</p><button type="button" className={editorButton} onClick={() => void reload()}>{shared('discard')}</button> <button type="button" className={editorButton} onClick={() => setConfirm(false)}>{shared('cancel')}</button></div>}
      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section data-tour="offer-publication" className="space-y-4 rounded-2xl border border-sf-border bg-sf-base p-5"><h2 className="font-semibold">{t('publication')}</h2><p className="text-sm text-sf-muted">{t(snapshot.published?.enabled ? 'live' : 'notLive')}</p>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" aria-label={t('enabled')} className="mt-1 h-4 w-4 accent-sf-accent" checked={config.enabled} disabled={busy} onChange={event => edit({ ...config, enabled: event.target.checked })} /><span><strong className="block">{t('enabled')}</strong><span className="mt-1 block text-xs text-sf-muted">{t('enabledHelp')}</span></span></label>
            <a className={`${editorButton} flex items-center justify-center gap-2`} href={`${prefix}/admin/templates/history?product=${productId}`}><History size={16} aria-hidden="true" />{t('history')}</a>
            {snapshot.draft && !dirty && <a className={`${editorButton} flex items-center justify-center gap-2`} href={`/template-preview/${snapshot.revision}?locale=${locale}&fixture=published-products&productId=${productId}`} target="_blank" rel="noreferrer"><Eye size={16} aria-hidden="true" />{t('preview')}</a>}
            {dirty && <p className="text-xs text-sf-muted">{t('saveFirst')}</p>}
          </section>
          <nav data-tour="offer-sections" aria-label={shared('sections')} className="grid gap-2">{(['offer.hero', 'offer.faq', 'offer.closing'] as const).map(id => <button type="button" key={id} aria-pressed={section === id} className={`${editorButton} text-left ${section === id ? 'border-sf-accent bg-sf-accent-soft' : ''}`} onClick={() => setSection(id)}>{shared(`sectionNames.${id === 'offer.hero' ? 'hero' : id === 'offer.faq' ? 'faq' : 'closing'}`)}</button>)}</nav>
          <label className="block space-y-2 text-sm font-medium"><span>{t('density')}</span><select className={editorControl} value={config.settings.density} disabled={busy} onChange={event => edit({ ...config, settings: { density: event.target.value as 'comfortable' | 'compact' } })}><option value="comfortable">{shared('comfortable')}</option><option value="compact">{shared('densityCompact')}</option></select></label>
          {config.tokens && <button type="button" className={editorButton} disabled={busy} onClick={() => edit({ ...config, tokens: null })}>{t('resetAppearance')}</button>}
        </aside>
        <section data-tour="offer-editor" className="min-w-0 space-y-5 rounded-2xl border border-sf-border bg-sf-base p-5 sm:p-6"><header className="border-b border-sf-border pb-4"><h2 className="text-xl font-semibold">{shared(`sectionNames.${section === 'offer.hero' ? 'hero' : section === 'offer.faq' ? 'faq' : 'closing'}`)}</h2><p className="mt-2 text-sm text-sf-muted">{t('contentHelp')}</p></header><fieldset disabled={busy}><SlotEditor key={section} id={section} value={config.content[section]} onChange={value => edit({ ...config, content: { ...config.content, [section]: value } } as OfferPageConfig)} /></fieldset></section>
      </div>
      <details className="rounded-xl border border-sf-border p-4 text-sm"><summary className="cursor-pointer text-sf-muted">{shared('technical')}</summary><p className="mt-4">{shared('revision', { revision: snapshot.revision })}</p><pre className="mt-3 overflow-auto">{JSON.stringify(snapshot.validation, null, 2)}</pre></details>
    </>}
  </div>;
}
