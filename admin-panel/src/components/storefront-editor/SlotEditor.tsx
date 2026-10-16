'use client';

/** Localized seller content, shown within the selected composition section. */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ChangeEvent } from 'react';
import type { SlotContent, StorefrontConfig } from '@/lib/storefront-templates/schemas';

export type SlotId = keyof StorefrontConfig['content'];
const KINDS = { 'home.hero': 'hero', 'home.tasks': 'heading', 'home.starts': 'heading', 'home.faq': 'faq', 'home.closing': 'cta', 'home.comparison': 'comparison', 'home.catalogue': 'heading' } as const;
export const SLOT_IDS = Object.keys(KINDS) as SlotId[];
export const SLOT_SECTIONS = { 'home.hero': 'hero', 'home.tasks': 'tasks', 'home.starts': 'start', 'home.faq': 'faq', 'home.closing': 'closing', 'home.comparison': 'comparison', 'home.catalogue': 'catalogue' } as const;
export const editorControl = 'block w-full rounded-lg border border-sf-muted bg-sf-input px-3 py-2.5 text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent';
export const editorButton = 'min-h-11 rounded-lg border border-sf-border-medium bg-sf-base px-4 py-2 text-sm font-medium hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50';
function emptyContent(id: SlotId): SlotContent {
  const kind = KINDS[id];
  if (kind === 'comparison') return { kind, heading: '', body: '', items: [] };
  if (kind === 'faq') return { kind, items: [] };
  if (kind === 'hero') return { kind, heading: '', eyebrow: '', body: '', steps: [] };
  return { kind, heading: '', body: '' };
}
interface SlotEditorProps { comparisonProducts?: string[]; id: SlotId; value: StorefrontConfig['content'][SlotId]; onChange: (value: StorefrontConfig['content'][SlotId]) => void }
export default function SlotEditor({ id, value, onChange, comparisonProducts = [] }: SlotEditorProps) {
  const t = useTranslations('storefrontEditor');
  const uiLocale = useLocale() === 'pl' ? 'pl' : 'en';
  const [locale, setLocale] = useState<'en' | 'pl'>(value?.[uiLocale] ? uiLocale : value?.sourceLocale ?? uiLocale);
  const name = t(`sectionNames.${SLOT_SECTIONS[id]}`);
  const current = value ?? { sourceLocale: uiLocale, [uiLocale]: emptyContent(id) } as NonNullable<typeof value>;
  const content = current[locale] ?? emptyContent(id);
  const prefix = `${name} · ${locale.toUpperCase()}`;
  const update = (next: SlotContent) => onChange({ ...current, [locale]: next } as NonNullable<typeof value>);
  const textField = (field: 'heading' | 'eyebrow' | 'body', max: number) => {
    if (!(field in content)) return null;
    const props = { className: editorControl, 'aria-label': `${prefix} · ${t(field)}`, maxLength: max, value: String(content[field as keyof typeof content]), onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update({ ...content, [field]: event.target.value }) };
    return <label className="block space-y-2 text-sm font-medium" key={field}><span>{t(field)}</span>{field === 'body' ? <textarea {...props} rows={4} /> : <input {...props} />}</label>;
  };
  return <fieldset className="min-w-0 space-y-5">
    <legend className="sr-only">{t('contentTitle', { name })}</legend>
    <div className="flex items-center gap-1 rounded-xl bg-sf-raised p-1" aria-label={t('contentTab')}>
      {(['en', 'pl'] as const).map(language => <button key={language} type="button" data-add-locale={!current[language] ? language : undefined} aria-pressed={locale === language}
        aria-label={!current[language] ? t('addLocale', { locale: language.toUpperCase() }) : t(language === 'en' ? 'languageEn' : 'languagePl')}
        className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sf-accent ${locale === language ? 'bg-sf-base text-sf-heading shadow-sm' : 'text-sf-muted hover:text-sf-heading'}`}
        onClick={() => { if (!current[language]) onChange({ ...current, [language]: emptyContent(id) } as NonNullable<typeof value>); setLocale(language); }}>
        {t(language === 'en' ? 'languageEn' : 'languagePl')}
      </button>)}
    </div>
    <div className="space-y-5" lang={locale}>
      {textField('eyebrow', 80)}{textField('heading', 160)}{textField('body', 4000)}
      {content.kind === 'hero' && <label className="block space-y-2 text-sm font-medium"><span>{t('steps')}</span><textarea aria-label={`${prefix} · ${t('steps')}`} className={editorControl} rows={3} maxLength={1445} value={content.steps.join('\n')} onChange={event => update({ ...content, steps: event.target.value ? event.target.value.split('\n') : [] })} /></label>}
      {content.kind === 'comparison' && comparisonProducts.map((productId, index) => {
        const item = content.items.find(item => item.productId === productId) ?? { productId, eyebrow: '', heading: '', body: '', bullets: [] };
        const change = (patch: Partial<typeof item>) => update({ ...content, items: comparisonProducts.map(id => id === productId ? { ...item, ...patch } : content.items.find(value => value.productId === id) ?? { productId: id, eyebrow: '', heading: '', body: '', bullets: [] }) });
        return <div key={productId} className="space-y-3 rounded-xl border border-sf-border p-4">
          <p>{t('offerNumber', { number: index + 1 })}</p>
          {(['eyebrow', 'heading', 'body'] as const).map(field => <label key={field} className="block space-y-2 text-sm"><span>{t(field)}</span><textarea className={editorControl} aria-label={`${prefix} · ${index + 1} · ${t(field)}`} maxLength={field === 'body' ? 1000 : field === 'heading' ? 160 : 80} value={item[field]} onChange={event => change({ [field]: event.target.value })} /></label>)}
          <label className="block space-y-2 text-sm"><span>{t('steps')}</span><textarea className={editorControl} aria-label={`${prefix} · ${index + 1} · ${t('steps')}`} maxLength={1445} value={item.bullets.join('\n')} onChange={event => change({ bullets: event.target.value ? event.target.value.split('\n') : [] })} /></label>
        </div>;
      })}
      {content.kind === 'faq' && <>
        {content.items.map((item, index) => <div key={item.id} className="space-y-3 rounded-xl border border-sf-border p-4">
          <label className="block space-y-2 text-sm font-medium"><span>{t('question', { number: index + 1 })}</span><input aria-label={`${prefix} · ${t('question', { number: index + 1 })}`} className={editorControl} maxLength={240} value={item.question} onChange={event => update({ ...content, items: content.items.map((old, i) => i === index ? { ...old, question: event.target.value } : old) })} /></label>
          <label className="block space-y-2 text-sm font-medium"><span>{t('answer', { number: index + 1 })}</span><textarea aria-label={`${prefix} · ${t('answer', { number: index + 1 })}`} className={editorControl} maxLength={4000} rows={3} value={item.answer} onChange={event => update({ ...content, items: content.items.map((old, i) => i === index ? { ...old, answer: event.target.value } : old) })} /></label>
          <button type="button" className={editorButton} onClick={() => update({ ...content, items: content.items.filter((_, i) => i !== index) })}>{t('removeQuestion', { number: index + 1 })}</button>
        </div>)}
        <button type="button" className={editorButton} disabled={content.items.length >= 20} onClick={() => {
          let number = 1; while (content.items.some(item => item.id === `question-${number}`)) number++;
          update({ ...content, items: [...content.items, { id: `question-${number}`, question: '', answer: '' }] });
        }}>{t('addQuestion')}</button>
      </>}
    </div>
    <div className="space-y-3 border-t border-sf-border pt-4 text-sm text-sf-muted">
      <p>{t('translationHint')}</p>
      <label className="flex flex-wrap items-center gap-3">{t('source')}<select aria-label={`${name} · ${t('source')}`} className="rounded-md border border-sf-muted bg-sf-input p-2 text-sf-heading" value={current.sourceLocale} onChange={event => onChange({ ...current, sourceLocale: event.target.value } as NonNullable<typeof value>)}>{(['en', 'pl'] as const).map(language => <option key={language} value={language} disabled={!current[language]}>{t(language === 'en' ? 'languageEn' : 'languagePl')}</option>)}</select></label>
      {locale !== current.sourceLocale && current[locale] && <button type="button" className={editorButton} onClick={() => { const next = { ...current }; delete next[locale]; onChange(next as NonNullable<typeof value>); setLocale(current.sourceLocale); }}>{t('removeLocale', { locale: locale.toUpperCase() })}</button>}
    </div>
  </fieldset>;
}
