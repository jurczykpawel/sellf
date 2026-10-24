'use client';

/** Revision-bound composition authoring; persistence uses the shared session action. @see lifecycle.ts */
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, RotateCcw, Eye, Layers } from 'lucide-react';
import { importLegacyStorefrontTheme } from '@/lib/actions/storefront-legacy-theme';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { normalizeConfigOrders, STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import TemplateLicenses from '@/components/storefront-editor/TemplateLicenses';
import ValidationIssues from '@/components/storefront-editor/ValidationIssues';
import AppearanceEditor from '@/components/storefront-editor/AppearanceEditor';
import DraftActions from '@/components/storefront-editor/DraftActions';
import BindingPicker from '@/components/storefront-editor/BindingPicker';
import ReorderHandle from '@/components/ui/ReorderHandle';
import SlotEditor, { SLOT_IDS, SLOT_SECTIONS, editorButton, editorControl } from '@/components/storefront-editor/SlotEditor';
import type { SectionIntent } from '@/lib/storefront-templates/section-descriptors';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateReadResult } from '@/lib/storefront-templates/lifecycle';
import type { StorefrontConfig, TemplateRegistryEntry, TemplateSettings } from '@/lib/storefront-templates/schemas';

function revealSection(id: string) {
  const panel = document.getElementById(id);
  panel?.focus({ preventScroll: true });
  panel?.scrollIntoView?.({ block: 'start' });
}

interface StorefrontEditorProps { initial: TemplateReadResult | null }
export default function StorefrontEditor({ initial }: StorefrontEditorProps) {
  const locale = useLocale() === 'pl' ? 'pl' : 'en';
  const t = useTranslations('storefrontEditor');
  const templateName = (id: string) => id === 'storefront-a' || id === 'storefront-b' || id === 'storefront-c' ? STOREFRONT_TEMPLATES[id].label[locale] : t(id === 'd' ? 'dName' : 'defaultName');
  const appearance = useTranslations('storefrontAppearance');
  const sectionListId = useId();
  const sectionListRef = useRef<HTMLOListElement>(null);
  const [selected, setSelected] = useState('hero');
  const [arrangement, setArrangement] = useState('');
  const [snapshot, setSnapshot] = useState(initial);
  const [config, setConfig] = useState<StorefrontConfig | null>(initial?.draft ?? initial?.published ?? null);
  const [validation, setValidation] = useState<ValidationResult | null>(initial?.validation ?? null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [message, setMessage] = useState(initial ? '' : t('failure'));
  function edit(next: StorefrontConfig) { setConfig(next); setDirty(JSON.stringify(normalizeConfigOrders(next)) !== JSON.stringify(normalizeConfigOrders(snapshot?.draft ?? snapshot?.published ?? next))); setSaved(false); }
  async function reload() {
    if (dirty && !confirmReload) { setConfirmReload(true); return; }
    setBusy(true); setMessage('');
    try {
      const response = await storefrontTemplateAction({ operation: 'read' });
      if (response.success && 'data' in response && 'revision' in response.data) {
        const data = response.data;
        setSnapshot(data); setConfig(data.draft ?? data.published); setValidation(data.validation);
        setDirty(false); setSaved(false); setConflict(false); setConfirmReload(false);
      } else setMessage(t('failure'));
    } catch { setMessage(t('failure')); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!config || !snapshot || conflict || busy || !dirty) return;
    const checked = validateConfig(config);
    setValidation(checked);
    if (!checked.valid) {
      const path = checked.errors[0]?.path ?? '';
      const slot = SLOT_IDS.find(id => path.includes(id));
      if (slot) setSelected(SLOT_SECTIONS[slot]);
      else if (path.includes('starterProducts')) setSelected('start');
      else if (path.includes('taskCategories')) setSelected('tasks');
      else if (path.includes('closingProduct')) setSelected('closing');
      else setSelected('hero');
      return;
    }
    setBusy(true); setMessage('');
    try {
      const normalized = normalizeConfigOrders(config);
      const response = await storefrontTemplateAction({ operation: 'draft', expectedRevision: snapshot.revision, config: normalized });
      if (response.success && 'revision' in response) {
        setSnapshot({ ...snapshot, revision: response.revision, draft: normalized });
        setConfig(normalized); setValidation(response.validation); setDirty(false); setSaved(true);
        try {
          const read = await storefrontTemplateAction({ operation: 'read' });
          if (read?.success && 'data' in read && 'revision' in read.data && read.data.revision === response.revision) setSnapshot(read.data);
        } catch { /* The committed revision remains saved if its diagnostic refresh fails. */ }
      } else if (!response.success) {
        setValidation(response.validation);
        if (response.code === 'CONFLICT') setConflict(true);
        else setMessage(t('failure'));
      }
    } catch { setMessage(t('failure')); }
    finally { setBusy(false); }
  }
  async function savedOperation(field?: string) {
    if (!config || !snapshot || dirty || busy || conflict) return { success: false, code: 'CONFLICT' };
    setBusy(true); setMessage('');
    try {
      const response = field
        ? await storefrontTemplateAction({ operation: 'reset', expectedRevision: snapshot.revision, templateId: config.templateId, field })
        : await importLegacyStorefrontTheme(snapshot.revision);
      if (response.success) {
        const read = await storefrontTemplateAction({ operation: 'read' });
        if (read.success && 'data' in read && 'revision' in read.data) {
          setSnapshot(read.data); setConfig(read.data.draft ?? read.data.published); setValidation(read.data.validation); setDirty(false);
        } else { setConflict(true); setMessage(t('failure')); }
      } else if (response.code === 'CONFLICT') setConflict(true);
      else if (field) setMessage(t('failure'));
      return response;
    } catch { setMessage(t('failure')); return { success: false, code: 'UNAVAILABLE' }; }
    finally { setBusy(false); }
  }
  const entry: TemplateRegistryEntry | null = config ? STOREFRONT_TEMPLATES[config.templateId] : null;
  const overrides = config?.overridesByTemplate[config.templateId];
  const layout = entry ? effectiveLayout(entry, overrides) : null;
  const order = layout?.order ?? [];
  function changeOverride(patch: object) {
    if (config) edit({ ...config, overridesByTemplate: { ...config.overridesByTemplate, [config.templateId]: { ...overrides, ...patch } } } as StorefrontConfig);
  }
  const diagnostics = [...validation?.errors ?? [], ...validation?.warnings ?? []];
  const sectionId = selected === 'appearance' ? selected : order.includes(selected) ? selected : order[0];
  const orderKey = order.join(',');
  useEffect(() => {
    const openSection = () => {
      const id = window.location.hash.slice(1);
      if (id === 'appearance' || orderKey.split(',').includes(id)) { setSelected(id); revealSection(id); }
    };
    openSection();
    window.addEventListener('hashchange', openSection);
    return () => window.removeEventListener('hashchange', openSection);
  }, [orderKey]);
  useEffect(() => {
    if (window.location.hash !== `#${sectionId}`) return;
    revealSection(sectionId);
  }, [sectionId]);
  useEffect(() => {
    const list = sectionListRef.current;
    if (!list) return;
    const revealSelected = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) return;
      const row = list.querySelector('[aria-pressed="true"]')?.closest('li');
      if (!row) return;
      const item = row.getBoundingClientRect(); const viewport = list.getBoundingClientRect();
      if (item.left < viewport.left) list.scrollLeft -= viewport.left - item.left;
      else if (item.right > viewport.right) list.scrollLeft += item.right - viewport.right;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected); observer.observe(list);
    return () => observer.disconnect();
  }, [sectionId, orderKey]);
  const selectedSection = layout?.sections.find(item => item.id === sectionId);
  const section = selectedSection?.spec;
  const sectionName = (id: string) => id === 'hero' && config?.templateId === 'storefront-c' ? t('authorHero') : id === 'hero' && config?.templateId === 'storefront-b' ? t('search-hero') : t(`sectionNames.${id}`);
  const sectionDescription = (id: string) => id === 'hero' && config?.templateId === 'storefront-c' ? t('authorHeroDescription') : id === 'hero' && config?.templateId === 'storefront-b' ? t('searchHeroDescription') : t(`sectionDescriptions.${id}`);
  const slotId = section && 'content' in section && section.content ? section.content.slot : null;
  const variants = selectedSection?.descriptor.variants ?? [];
  function changeSection(id: string, patch: SectionIntent) {
    const intent = { ...Object.entries(overrides?.sections ?? {}).find(([key]) => key === id)?.[1], ...patch };
    if (intent.variant === undefined) delete intent.variant;
    changeOverride({ sections: { ...overrides?.sections, [id]: intent } });
  }
  const field = section?.type === 'hero-product/1' ? 'heroProduct' : section?.type === 'product-cta/1' && 'product' in section ? 'closingProduct' : section?.type === 'product-list/1' ? section.products.setting : section?.type === 'task-nav/1' ? 'taskCategories' : null;
  const activeSettings: TemplateSettings = config ? config.settingsByTemplate[config.templateId] ?? {} : {};
  const binding = activeSettings[field ?? 'heroProduct'];
  const bindingIds = Array.isArray(binding) ? binding : binding ? [binding] : [];
  const bindingLabel = field === 'heroProduct' ? 'primaryOffer' : field === 'closingProduct' ? 'closingOffer' : field === 'featuredProducts' ? 'featuredOffers' : field === 'comparisonProducts' ? 'comparisonOffers' : field === 'starterProducts' ? 'startingOffers' : 'topics';
  function moveSection(index: number, target: number) {
    if (target < 0 || target >= order.length || index === target) return;
    const next = [...order]; const [id] = next.splice(index, 1); next.splice(target, 0, id); changeOverride({ order: next });
    setArrangement(`${sectionName(id)} · ${target + 1} / ${order.length}`);
  }
  return <div data-storefront-editor className="mx-auto max-w-6xl space-y-6 text-sf-heading">
    <header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1><p className="max-w-2xl text-sm text-sf-muted">{t('intro')}</p></header>
    <div data-editor-savebar className="sticky top-14 z-30 flex items-center justify-between gap-3 rounded-xl border border-sf-border bg-sf-base p-3 shadow-sm">
      <p role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2 text-sm text-sf-muted"><Check size={16} className={!saved || dirty ? 'hidden' : 'text-sf-success'} aria-hidden="true" /><span>{busy ? t('saving') : dirty ? t('unsaved') : saved ? t('savedState') : t('loadedState')}</span><span className="sr-only">{arrangement}</span></p>
      <div className="flex shrink-0 items-center gap-2"><button type="button" className={editorButton} aria-label={t('reload')} title={t('reload')} disabled={busy} onClick={reload}><RotateCcw size={17} aria-hidden="true" /></button>
      <button type="button" className="min-h-11 rounded-lg bg-sf-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50" disabled={busy || !config || conflict || !dirty} onClick={save}>{t('save')}</button></div>
    </div>
    <DraftActions revision={snapshot?.revision ?? null} enabled={!!snapshot?.draft && !dirty && !busy && !conflict} />
    {confirmReload && <div className="space-y-3 rounded-xl border border-sf-border bg-sf-base p-4"><p>{t('confirmReload')}</p><button type="button" className={editorButton} disabled={busy} onClick={reload}>{t('discard')}</button> <button type="button" className={editorButton} onClick={() => setConfirmReload(false)}>{t('cancel')}</button></div>}
    {(conflict || message || validation?.errors.length) ? <div role="alert" className="rounded-xl border border-sf-danger bg-sf-danger-soft p-4 text-sm">{conflict ? t('conflict') : message || t('invalidNotice')}</div> : null}
    <ValidationIssues issues={validation?.warnings.filter(issue => issue.code === 'BINDING') ?? []} onSelect={id => { window.location.hash = id; setSelected(id); revealSection(id); }} />
    {config && entry && <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-sf-border bg-sf-base p-4 sm:p-5"><Layers size={23} className="shrink-0 text-sf-accent" aria-hidden="true" /><label className="min-w-0 flex-1 space-y-1 text-sm font-semibold"><span>{t('template')}</span><select aria-label={t('template')} className={editorControl} value={config.templateId} onChange={event => { edit({ ...config, templateId: event.target.value as StorefrontConfig['templateId'] }); setSelected(event.target.value === 'default' ? 'catalogue' : 'hero'); }}>
        {Object.values(STOREFRONT_TEMPLATES).map(template => <option key={template.id} value={template.id}>{templateName(template.id)}{template.entitlement.kind === 'pro' ? ' · Pro' : ''}</option>)}
      </select></label></div>
      {snapshot && config.templateId !== 'default' && !snapshot.rights.availableTemplateIds.includes(config.templateId) && <p className="flex items-start gap-2 rounded-xl bg-sf-warning-soft p-3 text-sm text-sf-warning"><Eye size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{t(STOREFRONT_TEMPLATES[config.templateId].entitlement.kind === 'template-key' ? 'templateKeyNotice' : 'proNotice')}</p>}
      <TemplateLicenses />
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label={t('sections')} className="scroll-mt-36 min-w-0 space-y-3">
          <div><h2 className="scroll-mt-36 font-semibold">{t('sections')}</h2><p className="mt-1 text-xs text-sf-muted">{t(config.templateId === 'default' ? 'classicHint' : 'orderHint')}</p></div>
          <ol ref={sectionListRef} id={sectionListId} data-reorder-list className="relative flex min-w-0 gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-1 lg:overflow-visible">
            {order.map((id, index) => <li key={id} data-reorder-index={index} className={`flex w-64 shrink-0 items-center rounded-xl border p-2 lg:w-auto ${sectionId === id ? 'border-sf-accent bg-sf-accent-soft' : 'border-sf-border bg-sf-base'}`}
              onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const raw = event.dataTransfer.getData('text/plain'); if (event.dataTransfer.getData('application/x-sellf-list') === sectionListId && /^\d+$/.test(raw)) moveSection(Number(raw), index); }}>
              {order.length > 1 && <ReorderHandle name={sectionName(id)} index={index} count={order.length} onMove={target => moveSection(index, target)} />}
              <button type="button" aria-label={sectionName(id)} aria-pressed={sectionId === id} className="min-w-0 flex-1 rounded-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-sf-accent" onClick={() => setSelected(id)}><span className="block text-sm font-semibold">{sectionName(id)}</span><span className="mt-1 block text-xs leading-relaxed text-sf-muted">{sectionDescription(id)}</span></button>
              <label className="flex h-11 w-9 shrink-0 items-center justify-center" title={t('show', { id: sectionName(id) })}><input type="checkbox" aria-label={t('show', { id: sectionName(id) })} className="h-4 w-4 accent-sf-accent" checked={layout?.sections.find(section => section.id === id)?.visibility === 'visible'} disabled={!layout?.sections.find(section => section.id === id)?.descriptor.hideable} onChange={event => changeSection(id, { visibility: event.target.checked ? 'visible' : 'hidden' })} /></label>
            </li>)}
          </ol>
          <button type="button" aria-pressed={sectionId === 'appearance'} className={`${editorButton} w-full text-left ${sectionId === 'appearance' ? 'border-sf-accent bg-sf-accent-soft' : ''}`} onClick={() => setSelected('appearance')}>{appearance('title')}</button>
        </nav>
        {sectionId === 'appearance' && <AppearanceEditor draftActions={<DraftActions revision={snapshot?.revision ?? null} enabled={!!snapshot?.draft && !dirty && !busy && !conflict} />} config={config} dirty={dirty} blocked={busy || conflict} onChange={edit} onReset={async field => { await savedOperation(field); }} onImport={async () => { const response = await savedOperation(); return { success: response.success, ...('code' in response ? { code: response.code } : {}), ...('unsupported' in response ? { unsupported: response.unsupported } : {}) }; }} />}
        {section && <section id={sectionId} tabIndex={-1} data-editor-panel aria-label={sectionName(sectionId)} className="scroll-mt-36 min-w-0 space-y-6 rounded-2xl border border-sf-border bg-sf-base p-4 sm:p-6">
          <header className="space-y-1 border-b border-sf-border pb-5"><h2 className="text-xl font-semibold">{sectionName(sectionId)}</h2><p className="text-sm text-sf-muted">{sectionDescription(sectionId)}</p></header>
          {field && <div className="space-y-3"><BindingPicker key={`${config.templateId}:${field}`} label={t(bindingLabel)} kind={field === 'taskCategories' ? 'categories' : 'products'} selectedIds={bindingIds} maxItems={field === 'featuredProducts' ? 6 : field === 'comparisonProducts' ? 2 : field === 'starterProducts' ? 3 : field === 'taskCategories' ? 12 : 1} onChange={ids => {
            const settings: TemplateSettings = { ...activeSettings };
            if (field === 'heroProduct' || field === 'closingProduct') { if (ids[0]) settings[field] = ids[0]; else delete settings[field]; }
            else settings[field] = ids;
            edit({ ...config, settingsByTemplate: { ...config.settingsByTemplate, [config.templateId]: settings } });
          }} />{(field === 'heroProduct' || field === 'closingProduct') && bindingIds.length === 0 && <p className="text-sm text-sf-muted">{t('missingOffer')}</p>}</div>}
          {slotId && <SlotEditor taskCategories={activeSettings.taskCategories} comparisonProducts={config.settingsByTemplate['storefront-a']?.comparisonProducts} key={sectionId} id={slotId} value={config.content[slotId]} onChange={value => edit({ ...config, content: { ...config.content, [slotId]: value } } as StorefrontConfig)} />}
          {variants.length > 0 && <label className="block space-y-2 text-sm font-medium"><span>{t('layoutStyle')}</span><select aria-label={t('layoutStyle')} className={editorControl} value={selectedSection?.variantOrigin === 'seller' ? selectedSection.variant : ''} onChange={event => changeSection(sectionId, { variant: event.target.value || undefined })}><option value="">{t('inherited')}</option>{variants.map(variant => <option key={variant} value={variant}>{t(variant)}</option>)}</select></label>}
          {sectionId === 'catalogue' && config.templateId === 'd' && <label className="block space-y-2 text-sm font-medium"><span>{t('density')}</span><select aria-label={t('density')} className={editorControl} value={config.settingsByTemplate.d?.density ?? ''} onChange={event => { const settings: TemplateSettings = { ...activeSettings }; if (event.target.value) settings.density = event.target.value as 'compact' | 'comfortable'; else delete settings.density; edit({ ...config, settingsByTemplate: { ...config.settingsByTemplate, [config.templateId]: settings } }); }}><option value="">{t('inherited')}</option><option value="comfortable">{t('comfortable')}</option><option value="compact">{t('densityCompact')}</option></select></label>}
        </section>}
      </div>
    </fieldset>}
    {snapshot && <details className="rounded-xl border border-sf-border bg-sf-base p-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium text-sf-muted">{t('technical')}</summary><div className="space-y-4 break-words border-t border-sf-border pt-4">
      <p>{t('revision', { revision: snapshot.revision })}</p><p>{t('effective', { id: templateName(snapshot.effectiveTemplateId) })}</p><p>{t('unused', { slots: snapshot.unusedSlots.map(id => id in SLOT_SECTIONS ? sectionName(SLOT_SECTIONS[id as keyof typeof SLOT_SECTIONS]) : t('none')).join(', ') || t('none') })}</p>
      <ul className="space-y-2">{diagnostics.map((issue, index) => <li key={index}>{issue.code} · {issue.path} · {issue.message}</li>)}</ul>
      {config && snapshot.unusedSlots.length > 0 && <fieldset disabled={busy} className="space-y-2"><legend className="font-medium">{t('unusedContent')}</legend>{snapshot.unusedSlots.map(id => id in SLOT_SECTIONS ? <SlotEditor key={id} id={id as keyof typeof SLOT_SECTIONS} value={config.content[id as keyof typeof SLOT_SECTIONS]} onChange={value => edit({ ...config, content: { ...config.content, [id]: value } } as StorefrontConfig)} /> : null)}</fieldset>}
      <p>{t('originHelp')}</p><dl className="space-y-2">{snapshot.effectiveTokens.map(token => <div key={token.path} className="flex flex-wrap gap-x-3 border-b border-sf-border py-2"><dt className="min-w-0 max-w-full break-all font-mono">{token.path}</dt><dd>{token.value} · {t(token.origin)}</dd></div>)}</dl>
    </div></details>}
  </div>;
}
