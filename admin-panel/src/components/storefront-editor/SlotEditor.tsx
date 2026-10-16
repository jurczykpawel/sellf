'use client';

/** Localized seller content controls. @see storefront-templates/schemas.ts */
import { useTranslations } from 'next-intl';
import type { ChangeEvent } from 'react';
import type { SlotContent, StorefrontConfig } from '@/lib/storefront-templates/schemas';

export type SlotId = keyof StorefrontConfig['content'];
const KINDS = { 'home.hero': 'hero', 'home.tasks': 'heading', 'home.starts': 'heading', 'home.faq': 'faq', 'home.closing': 'cta' } as const;
export const SLOT_IDS = Object.keys(KINDS) as SlotId[];
const control = 'block w-full rounded-md border border-sf-muted bg-sf-input p-2 text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent';
export const editorControl = control;
export const editorButton = 'min-h-11 rounded-md border border-sf-muted px-3 py-2 text-sm hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50';
function emptyContent(id: SlotId): SlotContent {
  const kind = KINDS[id];
  if (kind === 'faq') return { kind, items: [] };
  if (kind === 'hero') return { kind, heading: '', eyebrow: '', body: '', steps: [] };
  return { kind, heading: '', body: '' };
}
interface SlotEditorProps { id: SlotId; value: StorefrontConfig['content'][SlotId]; onChange: (value: StorefrontConfig['content'][SlotId]) => void }
export default function SlotEditor({ id, value, onChange }: SlotEditorProps) {
  const t = useTranslations('storefrontEditor');
  if (!value) return <button type="button" className={editorButton} onClick={() => onChange({ sourceLocale: 'en', en: emptyContent(id) } as StorefrontConfig['content'][SlotId])}>{t('addSlot', { id })}</button>;
  const update = (locale: 'en' | 'pl', content: SlotContent | undefined) => {
    const next = { ...value, [locale]: content };
    if (!content) delete next[locale];
    onChange(next as StorefrontConfig['content'][SlotId]);
  };
  return <fieldset className="min-w-0 space-y-4 rounded-lg border border-sf-border p-4">
    <legend className="px-2 font-semibold">{id}</legend>
    <label className="block">{t('source')}<select aria-label={`${id} · ${t('source')}`} className={control} value={value.sourceLocale} onChange={event => onChange({ ...value, sourceLocale: event.target.value } as StorefrontConfig['content'][SlotId])}>
      {(['en', 'pl'] as const).map(locale => <option key={locale} value={locale} disabled={!value[locale]}>{locale.toUpperCase()}</option>)}
    </select></label>
    {(['en', 'pl'] as const).map(locale => {
      const content = value[locale];
      if (!content) return <button key={locale} type="button" data-add-locale={locale} className={editorButton} onClick={() => update(locale, emptyContent(id))}>{t('addLocale', { locale: locale.toUpperCase() })}</button>;
      const prefix = `${id} · ${locale.toUpperCase()}`;
      const textField = (field: 'heading' | 'eyebrow' | 'body', max: number) => {
        if (!(field in content)) return null;
        const label = `${prefix} · ${t(field)}`;
        const props = { className: control, 'aria-label': label, maxLength: max, value: String(content[field as keyof typeof content]), onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(locale, { ...content, [field]: event.target.value }) };
        return <label className="block" key={field}>{label}{field === 'body' ? <textarea {...props} rows={3} /> : <input {...props} />}</label>;
      };
      return <div key={locale} className="min-w-0 space-y-3 border-t border-sf-border pt-3" lang={locale}>
        <p className="font-semibold">{locale.toUpperCase()}</p>
        {textField('eyebrow', 80)}{textField('heading', 160)}{textField('body', 4000)}
        {content.kind === 'hero' && <label className="block">{t('steps')}<textarea aria-label={`${prefix} · ${t('steps')}`} className={control} rows={3} maxLength={1445} value={content.steps.join('\n')} onChange={event => update(locale, { ...content, steps: event.target.value ? event.target.value.split('\n') : [] })} /></label>}
        {content.kind === 'faq' && <>
          {content.items.map((item, index) => <div key={item.id} className="space-y-2">
            <label className="block">{t('question', { number: index + 1 })}<input aria-label={`${prefix} · ${t('question', { number: index + 1 })}`} className={control} maxLength={240} value={item.question} onChange={event => update(locale, { ...content, items: content.items.map((old, i) => i === index ? { ...old, question: event.target.value } : old) })} /></label>
            <label className="block">{t('answer', { number: index + 1 })}<textarea aria-label={`${prefix} · ${t('answer', { number: index + 1 })}`} className={control} maxLength={4000} rows={3} value={item.answer} onChange={event => update(locale, { ...content, items: content.items.map((old, i) => i === index ? { ...old, answer: event.target.value } : old) })} /></label>
            <button type="button" className={editorButton} onClick={() => update(locale, { ...content, items: content.items.filter((_, i) => i !== index) })}>{t('removeQuestion', { number: index + 1 })}</button>
          </div>)}
          <button type="button" className={editorButton} disabled={content.items.length >= 20} onClick={() => {
            let number = 1;
            while (content.items.some(item => item.id === `question-${number}`)) number++;
            update(locale, { ...content, items: [...content.items, { id: `question-${number}`, question: '', answer: '' }] });
          }}>{t('addQuestion')}</button>
        </>}
        {locale !== value.sourceLocale && <button type="button" className={editorButton} onClick={() => update(locale, undefined)}>{t('removeLocale', { locale: locale.toUpperCase() })}</button>}
      </div>;
    })}
  </fieldset>;
}
