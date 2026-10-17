'use client';

/** Draft appearance controls with resolved provenance. @see public-theme.ts */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw, Palette } from 'lucide-react';
import { CORE_TOKENS, resolvePublicTheme, validateThemeContrast } from '@/lib/storefront-templates/public-theme';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import { editorButton, editorControl } from '@/components/storefront-editor/SlotEditor';
import type { ReactNode } from 'react';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';

interface AppearanceEditorProps {
  config: StorefrontConfig; dirty: boolean; blocked: boolean;
  draftActions?: ReactNode;
  onChange: (config: StorefrontConfig) => void;
  onReset: (field: string) => Promise<void>;
  onImport: () => Promise<{ success: boolean; code?: string; unsupported?: string[] }>;
}
const choices: Record<string, readonly (string | number)[]> = {
  font: ['geist', 'dm-sans'], bodyWeight: [400, 500], headingWeight: [500, 600, 700], baseSizePx: [16, 17, 18], headingLetterSpacingEm: [-0.02, -0.01, 0],
  radiusSmPx: [0, 4, 8], radiusMdPx: [4, 8, 12], radiusLgPx: [8, 12, 16, 24],
};
export default function AppearanceEditor({ config, dirty, blocked, onChange, onReset, onImport, draftActions }: AppearanceEditorProps) {
  const t = useTranslations('storefrontAppearance');
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [importMessage, setImportMessage] = useState('');
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const entry = STOREFRONT_TEMPLATES[config.templateId];
  const resolved = resolvePublicTheme(entry.tokens, config.tokens, true);
  const protectedTheme = resolvePublicTheme(entry.tokens, config.tokens, true, 'protected');
  const candidate = structuredClone(entry.tokens ?? CORE_TOKENS);
  for (const group of ['light', 'dark', 'typography', 'shapes'] as const) Object.assign(candidate[group], config.tokens?.[group]);
  const failures = validateThemeContrast(candidate);
  function change(group: string, leaf: string, value: string | number) {
    onChange({ ...config, tokens: { ...config.tokens, format: 1, [group]: { ...config.tokens?.[group as 'light'], [leaf]: value } } });
  }
  function controls(group: 'light' | 'dark' | 'typography' | 'shapes') {
    return resolved.effective.filter(token => token.path.startsWith(`tokens.${group}.`)).map(token => {
      const leaf = token.path.split('.')[2];
      const stored = config.tokens?.[group] as Record<string, string | number> | undefined;
      const value = stored?.[leaf] ?? token.value;
      const label = group === 'light' || group === 'dark' ? `${t(group)} · ${t(leaf)}` : t(leaf);
      const invalid = failures.includes(token.path);
      return <div key={token.path} className="min-w-0 rounded-xl border border-sf-border bg-sf-base p-3">
        <label className="block space-y-2 text-sm font-medium"><span>{t(leaf)}</span>
          {group === 'light' || group === 'dark' ? <span className="flex items-center gap-3"><input aria-label={label} type="color" value={value} onChange={event => change(group, leaf, event.target.value)} className="h-11 w-14 shrink-0 cursor-pointer rounded border border-sf-border bg-transparent p-1" /><span className="font-mono text-xs text-sf-muted">{value}</span></span>
            : <select aria-label={label} className={editorControl} value={value} onChange={event => change(group, leaf, leaf === 'font' ? event.target.value : Number(event.target.value))}>{choices[leaf].map(option => <option key={option} value={option}>{leaf === 'font' ? option === 'geist' ? 'Geist' : 'DM Sans' : leaf.includes('Weight') ? t(option === 400 ? 'regular' : option === 500 ? 'medium' : option === 600 ? 'semibold' : 'bold') : `${option}${leaf.endsWith('Px') ? ' px' : ' em'}`}</option>)}</select>}
        </label>
        <div className="mt-2 flex min-h-9 items-center justify-between gap-2 text-xs"><span data-token-origin className="text-sf-muted">{t(token.origin)}{value !== token.value && <span className="block font-mono">{token.value}</span>}</span><button type="button" aria-label={t('reset', { name: label })} title={t('reset', { name: label })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-sf-raised focus-visible:outline-2 focus-visible:outline-sf-accent disabled:opacity-30" disabled={dirty || blocked || stored?.[leaf] === undefined} onClick={() => onReset(token.path)}><RotateCcw size={14} aria-hidden="true" /></button></div>
        {invalid && <p className="text-xs font-medium text-sf-danger">{t('contrastDetails')}</p>}
      </div>;
    });
  }
  return <section id="appearance" tabIndex={-1} aria-label={t('title')} className="scroll-mt-36 min-w-0 space-y-5 rounded-2xl border border-sf-border bg-sf-base p-4 sm:p-6">
    <header className="flex gap-3 border-b border-sf-border pb-5"><Palette size={24} className="shrink-0 text-sf-accent" aria-hidden="true" /><div><h2 className="text-xl font-semibold">{t('title')}</h2><p className="mt-1 text-sm text-sf-muted">{t('intro')}</p></div></header>
    {draftActions}
    <p role="status" className={`rounded-lg p-3 text-sm ${failures.length ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-raised text-sf-muted'}`}>{t(failures.length ? 'contrastBad' : 'contrastOk')}</p>
    <div className="flex gap-2" role="group" aria-label={t('title')}>{(['light', 'dark'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} className={`${editorButton} ${mode === item ? 'border-sf-accent bg-sf-accent-soft' : ''}`} onClick={() => setMode(item)}>{t(item)}</button>)}</div>
    <div hidden={mode !== 'light'} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{controls('light')}</div>
    <div hidden={mode !== 'dark'} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{controls('dark')}</div>
    {(['typography', 'shapes'] as const).map(group => <fieldset key={group} className="min-w-0 space-y-3"><legend className="mb-3 font-semibold">{t(group)}</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{controls(group)}</div></fieldset>)}
    <p className="text-xs text-sf-muted">{t('resetHint')}</p>
    <details className="rounded-xl border border-sf-border p-4 text-sm"><summary className="cursor-pointer py-2 font-semibold">{t('protectedTitle')}</summary><p className="my-3 text-sf-muted">{t('protectedIntro')}</p><dl className="grid gap-x-5 sm:grid-cols-2">{protectedTheme.effective.map(token => {
      const [, group, leaf] = token.path.split('.');
      return <div key={token.path} className="border-t border-sf-border py-2"><dt>{group === 'light' || group === 'dark' ? `${t(group)} · ` : ''}{t(leaf)}</dt><dd className="mt-1 text-xs text-sf-muted">{token.value} · {t(token.origin)}</dd></div>;
    })}</dl></details>
    <details className="rounded-xl border border-sf-border p-4"><summary className="cursor-pointer py-2 font-semibold">{t('legacyTitle')}</summary><p className="my-3 text-sm text-sf-muted">{t('legacyIntro')}</p><button type="button" className={editorButton} disabled={dirty || blocked} onClick={async () => {
      const response = await onImport(); setUnsupported(response.unsupported ?? []);
      setImportMessage(t(response.success ? 'imported' : ['ALREADY_IMPORTED', 'UNAVAILABLE', 'FORBIDDEN', 'INVALID'].includes(response.code ?? '') ? response.code! : 'UNAVAILABLE'));
    }}>{t('import')}</button>{importMessage && <p role="status" className="mt-3 text-sm">{importMessage}</p>}{unsupported.length > 0 && <><p className="mt-2 text-sm">{t('unsupported', { count: unsupported.length })}</p><details className="mt-3 text-xs"><summary className="cursor-pointer py-2">{t('technical')}</summary><ul>{unsupported.map(field => <li key={field} className="break-all py-1 font-mono">{field}</li>)}</ul></details></>}</details>
  </section>;
}
