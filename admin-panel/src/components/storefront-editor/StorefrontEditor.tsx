'use client';

/** Revision-bound composition authoring; persistence uses the shared session action. @see lifecycle.ts */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import SlotEditor, { SLOT_IDS, editorButton, editorControl } from '@/components/storefront-editor/SlotEditor';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateReadResult } from '@/lib/storefront-templates/lifecycle';
import type { StorefrontConfig, TemplateRegistryEntry } from '@/lib/storefront-templates/schemas';

interface BindingInputProps { value: string; maxLength: number; onChange: (value: string) => void }
function BindingInput({ value, maxLength, onChange }: BindingInputProps) {
  const [text, setText] = useState(value);
  return <input className={editorControl} maxLength={maxLength} value={text} onChange={event => { setText(event.target.value); onChange(event.target.value); }} />;
}

interface StorefrontEditorProps { initial: TemplateReadResult | null }
export default function StorefrontEditor({ initial }: StorefrontEditorProps) {
  const t = useTranslations('storefrontEditor');
  const locale = useLocale() === 'pl' ? 'pl' : 'en';
  const [snapshot, setSnapshot] = useState(initial);
  const [config, setConfig] = useState<StorefrontConfig | null>(initial?.draft ?? initial?.published ?? null);
  const [validation, setValidation] = useState<ValidationResult | null>(initial?.validation ?? null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [message, setMessage] = useState(initial ? '' : t('failure'));
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  function edit(next: StorefrontConfig) { setConfig(next); setDirty(true); setSavedRevision(null); }
  async function reload() {
    if (dirty && !confirmReload) { setConfirmReload(true); return; }
    setBusy(true); setMessage('');
    try {
      const response = await storefrontTemplateAction({ operation: 'read' });
      if (response.success && 'data' in response && 'revision' in response.data) {
        const data = response.data;
        setSnapshot(data); setConfig(data.draft ?? data.published); setValidation(data.validation);
        setDirty(false); setConflict(false); setConfirmReload(false); setSavedRevision(null); setReloadVersion(version => version + 1);
      } else setMessage(t('failure'));
    } catch { setMessage(t('failure')); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!config || !snapshot || conflict || busy) return;
    const checked = validateConfig(config);
    setValidation(checked);
    if (!checked.valid) return;
    setBusy(true); setMessage('');
    try {
      const response = await storefrontTemplateAction({ operation: 'draft', expectedRevision: snapshot.revision, config });
      if (response.success && 'revision' in response) {
        setSnapshot({ ...snapshot, revision: response.revision, draft: config });
        setValidation(response.validation); setDirty(false); setSavedRevision(response.revision);
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
  const entry: TemplateRegistryEntry | null = config ? STOREFRONT_TEMPLATES[config.templateId] : null;
  const overrides = config?.overridesByTemplate[config.templateId];
  const hidden: readonly string[] = overrides?.hidden ?? [];
  const variantsById: Record<string, string | undefined> = overrides?.variants ?? {};
  const order = overrides?.order ?? entry?.defaults.sections.map(section => section.id) ?? [];
  function changeOverride(patch: object) {
    if (config) edit({ ...config, overridesByTemplate: { ...config.overridesByTemplate, [config.templateId]: { ...overrides, ...patch } } } as StorefrontConfig);
  }
  const diagnostics = [...validation?.errors ?? [], ...validation?.warnings ?? []];
  return <div data-storefront-editor className="mx-auto max-w-5xl space-y-6 p-4 text-sf-heading sm:p-6">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">{t('title')}</h1><p>{t('intro')}</p><p className="text-sm">{t('retained')}</p></header>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={editorButton} disabled={busy || !config || conflict || !dirty} onClick={save}>{t('save')}</button>
      <button type="button" className={editorButton} disabled={busy} onClick={reload}>{t('reload')}</button>
      <p role="status" aria-live="polite">{savedRevision !== null ? t('saved', { revision: savedRevision }) : snapshot ? t('revision', { revision: snapshot.revision }) : ''}{dirty ? ` · ${t('unsaved')}` : ''}</p>
    </div>
    {confirmReload && <div className="space-y-2 rounded-md border border-sf-border p-4"><p>{t('confirmReload')}</p><button type="button" className={editorButton} disabled={busy} onClick={reload}>{t('discard')}</button> <button type="button" className={editorButton} onClick={() => setConfirmReload(false)}>{t('cancel')}</button></div>}
    {(conflict || message || validation?.errors.length) ? <div role="alert" className="break-words rounded-md border border-sf-border p-4">{conflict ? t('conflict') : message}{validation?.errors.map((issue, index) => <p key={index}>{issue.code} · {issue.path} · {issue.message}</p>)}</div> : null}
    {config && entry && <fieldset disabled={busy} className="min-w-0 space-y-6">
      <label className="block font-medium">{t('template')}<select aria-label={t('template')} className={editorControl} value={config.templateId} onChange={event => edit({ ...config, templateId: event.target.value as StorefrontConfig['templateId'] })}>
        {Object.values(STOREFRONT_TEMPLATES).map(template => <option key={template.id} value={template.id}>{template.label[locale]}{template.entitlement.kind === 'pro' ? ' · Pro' : ''}</option>)}
      </select></label>
      {entry.settings.length > 0 && <fieldset className="min-w-0 space-y-4 rounded-lg border border-sf-border p-4"><legend className="px-2 font-semibold">{t('bindings')}</legend><p className="text-sm">{t('bindingHelp')}</p>
        {entry.settings.map(setting => {
          const value = config.settingsByTemplate.d?.[setting.id];
          const change = (raw: string) => {
            const next = { ...config.settingsByTemplate.d, [setting.id]: setting.kind === 'products' || setting.kind === 'categories' ? raw.split(',').map(id => id.trim()).filter(Boolean) : raw };
            if (!raw) delete next[setting.id];
            edit({ ...config, settingsByTemplate: { ...config.settingsByTemplate, d: next } });
          };
          return <label key={setting.id} className="block">{setting.label[locale]}
            {setting.kind === 'density' ? <select aria-label={setting.label[locale]} className={editorControl} value={String(value ?? '')} onChange={event => change(event.target.value)}><option value="">{t('inherited')}</option><option value="comfortable">{t('comfortable')}</option><option value="compact">{t('compact')}</option></select>
              : <BindingInput key={`${reloadVersion}:${snapshot?.revision}:${config.templateId}:${setting.id}`} maxLength={setting.kind === 'product' ? 36 : 12 * 38} value={Array.isArray(value) ? value.join(', ') : value ?? ''} onChange={change} />}
          </label>;
        })}
      </fieldset>}
      <fieldset className="min-w-0 space-y-3 rounded-lg border border-sf-border p-4"><legend className="px-2 font-semibold">{t('sections')}</legend>
        {order.map((id, index) => {
          const section = entry.defaults.sections.find(item => item.id === id)!;
          const optional = ['tasks', 'start', 'faq'].includes(id);
          const variants = section.type === 'hero-product/1' ? ['split-process', 'simple'] : section.type === 'product-list/1' ? ['detail-cards', 'compact'] : section.type === 'catalogue/1' ? ['detail-cards', 'default-groups'] : [];
          const move = (offset: number) => { const next = [...order]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; changeOverride({ order: next }); };
          return <div key={id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-sf-border p-3">
            <span className="font-mono text-sm">{index + 1}. {id}</span>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!hidden.includes(id)} disabled={!optional} onChange={event => changeOverride({ hidden: event.target.checked ? overrides?.hidden?.filter(item => item !== id) ?? [] : [...overrides?.hidden ?? [], id] })} />{t('show', { id })}</label>
            <button type="button" className={editorButton} disabled={index === 0} onClick={() => move(-1)}>{t('up', { id })}</button><button type="button" className={editorButton} disabled={index === order.length - 1} onClick={() => move(1)}>{t('down', { id })}</button>
            {variants.length > 0 && <label className="min-w-0 flex-1">{t('variant', { id })}<select aria-label={t('variant', { id })} className={editorControl} value={variantsById[id] ?? ''} onChange={event => {
              const next = { ...overrides?.variants } as Record<string, string>;
              if (event.target.value) next[id] = event.target.value; else delete next[id];
              changeOverride({ variants: next });
            }}><option value="">{t('inherited')}</option>{variants.map(variant => <option key={variant}>{variant}</option>)}</select></label>}
          </div>;
        })}
      </fieldset>
      <section className="space-y-4" aria-label={t('slots')}><h2 className="text-xl font-semibold">{t('slots')}</h2>{SLOT_IDS.map(id => <SlotEditor key={id} id={id} value={config.content[id]} onChange={value => edit({ ...config, content: { ...config.content, [id]: value } } as StorefrontConfig)} />)}</section>
    </fieldset>}
    {snapshot && <section className="space-y-3 break-words" aria-label={t('diagnostics')}><h2 className="text-xl font-semibold">{t('diagnostics')}</h2><p>{t('effective', { id: snapshot.effectiveTemplateId })}</p><p>{t('unused', { slots: snapshot.unusedSlots.join(', ') || t('none') })}</p>
      <ul className="space-y-2">{diagnostics.map((issue, index) => <li key={index}>{issue.code} · {issue.path} · {issue.message}</li>)}</ul>
      <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('origins')}</summary><p>{t('originHelp')}</p><dl className="space-y-2">{snapshot.effectiveTokens.map(token => <div key={token.path} className="flex flex-wrap gap-x-3 border-b border-sf-border py-2"><dt className="min-w-0 max-w-full break-all font-mono">{token.path}</dt><dd>{token.value} · {t(token.origin)}</dd></div>)}</dl></details>
    </section>}
  </div>;
}
