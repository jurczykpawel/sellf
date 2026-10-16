'use client';

/** Revision-bound composition authoring; persistence uses the shared session action. @see lifecycle.ts */
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, RotateCcw, Eye, Layers } from 'lucide-react';
import { importLegacyStorefrontTheme } from '@/lib/actions/storefront-legacy-theme';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import TemplateLicenses from '@/components/storefront-editor/TemplateLicenses';
import AppearanceEditor from '@/components/storefront-editor/AppearanceEditor';
import BindingPicker from '@/components/storefront-editor/BindingPicker';
import ReorderHandle from '@/components/ui/ReorderHandle';
import SlotEditor, { SLOT_IDS, SLOT_SECTIONS, editorButton, editorControl } from '@/components/storefront-editor/SlotEditor';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateReadResult } from '@/lib/storefront-templates/lifecycle';
import type { StorefrontConfig, TemplateRegistryEntry } from '@/lib/storefront-templates/schemas';

interface StorefrontEditorProps { initial: TemplateReadResult | null }
export default function StorefrontEditor({ initial }: StorefrontEditorProps) {
  const t = useTranslations('storefrontEditor');
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
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [message, setMessage] = useState(initial ? '' : t('failure'));
  function edit(next: StorefrontConfig) { setConfig(next); setDirty(true); }
  async function reload() {
    if (dirty && !confirmReload) { setConfirmReload(true); return; }
    setBusy(true); setMessage('');
    try {
      const response = await storefrontTemplateAction({ operation: 'read' });
      if (response.success && 'data' in response && 'revision' in response.data) {
        const data = response.data;
        setSnapshot(data); setConfig(data.draft ?? data.published); setValidation(data.validation);
        setDirty(false); setConflict(false); setConfirmReload(false);
      } else setMessage(t('failure'));
    } catch { setMessage(t('failure')); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!config || !snapshot || conflict || busy) return;
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
      const response = await storefrontTemplateAction({ operation: 'draft', expectedRevision: snapshot.revision, config });
      if (response.success && 'revision' in response) {
        setSnapshot({ ...snapshot, revision: response.revision, draft: config });
        setValidation(response.validation); setDirty(false);
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
  const hidden: readonly string[] = overrides?.hidden ?? [];
  const variantsById: Record<string, string | undefined> = overrides?.variants ?? {};
  const order = overrides?.order ?? entry?.defaults.sections.map(section => section.id) ?? [];
  function changeOverride(patch: object) {
    if (config) edit({ ...config, overridesByTemplate: { ...config.overridesByTemplate, [config.templateId]: { ...overrides, ...patch } } } as StorefrontConfig);
  }
  const diagnostics = [...validation?.errors ?? [], ...validation?.warnings ?? []];
  const sectionId = selected === 'appearance' ? selected : order.includes(selected) ? selected : order[0];
  const orderKey = order.join(',');
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
  const section = entry?.defaults.sections.find(item => item.id === sectionId);
  const sectionName = (id: string) => t(`sectionNames.${id}`);
  const slotId = section && 'content' in section ? section.content.slot : null;
  const variants = section?.type === 'hero-product/1' ? ['split-process', 'simple'] : section?.type === 'product-list/1' ? ['detail-cards', 'compact'] : section?.type === 'catalogue/1' ? ['detail-cards', 'default-groups'] : [];
  const field = section?.type === 'hero-product/1' ? 'heroProduct' : section?.type === 'product-cta/1' ? 'closingProduct' : section?.type === 'product-list/1' ? 'starterProducts' : section?.type === 'task-nav/1' ? 'taskCategories' : null;
  const binding = config?.settingsByTemplate.d?.[field ?? 'heroProduct'];
  const bindingIds = Array.isArray(binding) ? binding : binding ? [binding] : [];
  const bindingLabel = field === 'heroProduct' ? 'primaryOffer' : field === 'closingProduct' ? 'closingOffer' : field === 'starterProducts' ? 'startingOffers' : 'topics';
  function moveSection(index: number, target: number) {
    if (target < 0 || target >= order.length || index === target) return;
    const next = [...order]; const [id] = next.splice(index, 1); next.splice(target, 0, id); changeOverride({ order: next });
    setArrangement(`${sectionName(id)} · ${target + 1} / ${order.length}`);
  }
  return <div data-storefront-editor className="mx-auto max-w-6xl space-y-6 text-sf-heading">
    <header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1><p className="max-w-2xl text-sm text-sf-muted">{t('intro')}</p></header>
    <div data-editor-savebar className="sticky top-14 z-30 flex items-center justify-between gap-3 rounded-xl border border-sf-border bg-sf-base p-3 shadow-sm">
      <p role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2 text-sm text-sf-muted"><Check size={16} className={dirty ? 'hidden' : 'text-sf-success'} aria-hidden="true" /><span className="truncate">{busy ? t('saving') : dirty ? t('unsaved') : t('savedState')}</span><span className="sr-only">{arrangement}</span></p>
      <div className="flex shrink-0 items-center gap-2"><button type="button" className={editorButton} aria-label={t('reload')} title={t('reload')} disabled={busy} onClick={reload}><RotateCcw size={17} aria-hidden="true" /></button>
      <button type="button" className="min-h-11 rounded-lg bg-sf-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50" disabled={busy || !config || conflict || !dirty} onClick={save}>{t('save')}</button></div>
    </div>
    {confirmReload && <div className="space-y-3 rounded-xl border border-sf-border bg-sf-base p-4"><p>{t('confirmReload')}</p><button type="button" className={editorButton} disabled={busy} onClick={reload}>{t('discard')}</button> <button type="button" className={editorButton} onClick={() => setConfirmReload(false)}>{t('cancel')}</button></div>}
    {(conflict || message || validation?.errors.length) ? <div role="alert" className="rounded-xl border border-sf-danger bg-sf-danger-soft p-4 text-sm">{conflict ? t('conflict') : message || t('invalidNotice')}</div> : null}
    {config && entry && <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-sf-border bg-sf-base p-4 sm:p-5"><Layers size={23} className="shrink-0 text-sf-accent" aria-hidden="true" /><label className="min-w-0 flex-1 space-y-1 text-sm font-semibold"><span>{t('template')}</span><select aria-label={t('template')} className={editorControl} value={config.templateId} onChange={event => { edit({ ...config, templateId: event.target.value as StorefrontConfig['templateId'] }); setSelected(event.target.value === 'd' ? 'hero' : 'catalogue'); }}>
        {Object.values(STOREFRONT_TEMPLATES).map(template => <option key={template.id} value={template.id}>{t(template.id === 'd' ? 'dName' : 'defaultName')}{template.entitlement.kind === 'pro' ? ' · Pro' : ''}</option>)}
      </select></label></div>
      {snapshot && config.templateId !== 'default' && !snapshot.rights.availableTemplateIds.includes(config.templateId) && <p className="flex items-start gap-2 rounded-xl bg-sf-warning-soft p-3 text-sm text-sf-warning"><Eye size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{t('proNotice')}</p>}
      <TemplateLicenses />
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label={t('sections')} className="min-w-0 space-y-3">
          <div><h2 className="font-semibold">{t('sections')}</h2><p className="mt-1 text-xs text-sf-muted">{t('orderHint')}</p></div>
          <ol ref={sectionListRef} id={sectionListId} data-reorder-list className="relative flex min-w-0 gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-1 lg:overflow-visible">
            {order.map((id, index) => <li key={id} data-reorder-index={index} className={`flex w-64 shrink-0 items-center rounded-xl border p-2 lg:w-auto ${sectionId === id ? 'border-sf-accent bg-sf-accent-soft' : 'border-sf-border bg-sf-base'}`}
              onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const raw = event.dataTransfer.getData('text/plain'); if (event.dataTransfer.getData('application/x-sellf-list') === sectionListId && /^\d+$/.test(raw)) moveSection(Number(raw), index); }}>
              <ReorderHandle name={sectionName(id)} index={index} count={order.length} onMove={target => moveSection(index, target)} />
              <button type="button" aria-label={sectionName(id)} aria-pressed={sectionId === id} className="min-w-0 flex-1 rounded-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-sf-accent" onClick={() => setSelected(id)}><span className="block text-sm font-semibold">{sectionName(id)}</span><span className="mt-1 block text-xs leading-relaxed text-sf-muted">{t(`sectionDescriptions.${id}`)}</span></button>
              <label className="flex h-11 w-9 shrink-0 items-center justify-center" title={t('show', { id: sectionName(id) })}><input type="checkbox" aria-label={t('show', { id: sectionName(id) })} className="h-4 w-4 accent-sf-accent" checked={!hidden.includes(id)} disabled={!['tasks', 'start', 'faq'].includes(id)} onChange={event => changeOverride({ hidden: event.target.checked ? hidden.filter(item => item !== id) : [...hidden, id] })} /></label>
            </li>)}
          </ol>
          <button type="button" aria-pressed={sectionId === 'appearance'} className={`${editorButton} w-full text-left ${sectionId === 'appearance' ? 'border-sf-accent bg-sf-accent-soft' : ''}`} onClick={() => setSelected('appearance')}>{appearance('title')}</button>
        </nav>
        {sectionId === 'appearance' && <AppearanceEditor config={config} dirty={dirty} blocked={busy || conflict} onChange={edit} onReset={async field => { await savedOperation(field); }} onImport={async () => { const response = await savedOperation(); return { success: response.success, ...('code' in response ? { code: response.code } : {}), ...('unsupported' in response ? { unsupported: response.unsupported } : {}) }; }} />}
        {section && <section data-editor-panel aria-label={sectionName(sectionId)} className={`min-w-0 space-y-6 rounded-2xl border bg-sf-base p-4 sm:p-6 ${validation?.errors.length ? 'border-sf-danger' : 'border-sf-border'}`}>
          <header className="space-y-1 border-b border-sf-border pb-5"><h2 className="text-xl font-semibold">{sectionName(sectionId)}</h2><p className="text-sm text-sf-muted">{t(`sectionDescriptions.${sectionId}`)}</p></header>
          {field && <div className="space-y-3"><BindingPicker key={`${config.templateId}:${field}`} label={t(bindingLabel)} kind={field === 'taskCategories' ? 'categories' : 'products'} selectedIds={bindingIds} maxItems={field === 'starterProducts' ? 3 : field === 'taskCategories' ? 12 : 1} onChange={ids => {
            const settings = { ...config.settingsByTemplate.d };
            if (field === 'heroProduct' || field === 'closingProduct') { if (ids[0]) settings[field] = ids[0]; else delete settings[field]; }
            else settings[field] = ids;
            edit({ ...config, settingsByTemplate: { ...config.settingsByTemplate, d: settings } });
          }} />{(field === 'heroProduct' || field === 'closingProduct') && bindingIds.length === 0 && <p className="text-sm text-sf-muted">{t('missingOffer')}</p>}</div>}
          {slotId && <SlotEditor key={sectionId} id={slotId} value={config.content[slotId]} onChange={value => edit({ ...config, content: { ...config.content, [slotId]: value } } as StorefrontConfig)} />}
          {variants.length > 0 && <label className="block space-y-2 text-sm font-medium"><span>{t('layoutStyle')}</span><select aria-label={t('layoutStyle')} className={editorControl} value={variantsById[sectionId] ?? ''} onChange={event => {
            const next = { ...overrides?.variants } as Record<string, string>; if (event.target.value) next[sectionId] = event.target.value; else delete next[sectionId]; changeOverride({ variants: next });
          }}><option value="">{t('inherited')}</option>{variants.map(variant => <option key={variant} value={variant}>{t(variant)}</option>)}</select></label>}
          {sectionId === 'catalogue' && config.templateId === 'd' && <label className="block space-y-2 text-sm font-medium"><span>{t('density')}</span><select aria-label={t('density')} className={editorControl} value={config.settingsByTemplate.d?.density ?? ''} onChange={event => { const settings = { ...config.settingsByTemplate.d }; if (event.target.value) settings.density = event.target.value as 'compact' | 'comfortable'; else delete settings.density; edit({ ...config, settingsByTemplate: { ...config.settingsByTemplate, d: settings } }); }}><option value="">{t('inherited')}</option><option value="comfortable">{t('comfortable')}</option><option value="compact">{t('densityCompact')}</option></select></label>}
        </section>}
      </div>
    </fieldset>}
    {snapshot && <details className="rounded-xl border border-sf-border bg-sf-base p-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium text-sf-muted">{t('technical')}</summary><div className="space-y-4 break-words border-t border-sf-border pt-4">
      <p>{t('revision', { revision: snapshot.revision })}</p><p>{t('effective', { id: t(snapshot.effectiveTemplateId === 'd' ? 'dName' : 'defaultName') })}</p><p>{t('unused', { slots: snapshot.unusedSlots.map(id => id in SLOT_SECTIONS ? sectionName(SLOT_SECTIONS[id as keyof typeof SLOT_SECTIONS]) : t('none')).join(', ') || t('none') })}</p>
      <ul className="space-y-2">{diagnostics.map((issue, index) => <li key={index}>{issue.code} · {issue.path} · {issue.message}</li>)}</ul>
      {config && snapshot.unusedSlots.length > 0 && <fieldset disabled={busy} className="space-y-2"><legend className="font-medium">{t('unusedContent')}</legend>{snapshot.unusedSlots.map(id => id in SLOT_SECTIONS ? <SlotEditor key={id} id={id as keyof typeof SLOT_SECTIONS} value={config.content[id as keyof typeof SLOT_SECTIONS]} onChange={value => edit({ ...config, content: { ...config.content, [id]: value } } as StorefrontConfig)} /> : null)}</fieldset>}
      <p>{t('originHelp')}</p><dl className="space-y-2">{snapshot.effectiveTokens.map(token => <div key={token.path} className="flex flex-wrap gap-x-3 border-b border-sf-border py-2"><dt className="min-w-0 max-w-full break-all font-mono">{token.path}</dt><dd>{token.value} · {t(token.origin)}</dd></div>)}</dl>
    </div></details>}
  </div>;
}
