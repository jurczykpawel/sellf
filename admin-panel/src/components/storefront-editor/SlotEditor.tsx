'use client';

/** Localized seller content, shown within the selected composition section. */
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import BindingPicker from '@/components/storefront-editor/BindingPicker';
import type { ChangeEvent, ComponentProps } from 'react';
import type { OfferPageConfig } from '@/lib/storefront-templates/offer-repository';
import type { SlotContent, StorefrontConfig } from '@/lib/storefront-templates/schemas';

export type SlotId = keyof StorefrontConfig['content'] | keyof OfferPageConfig['content'];
const KINDS = { 'offer.hero': 'hero', 'offer.faq': 'faq', 'offer.closing': 'cta', 'home.hero': 'hero', 'home.tasks': 'heading', 'home.starts': 'heading', 'home.faq': 'faq', 'home.closing': 'cta', 'home.comparison': 'comparison', 'home.catalogue': 'heading', 'home.search': 'search', 'home.featured': 'heading', 'home.starter': 'cta', 'home.author': 'author', 'home.story': 'biography', 'home.paths': 'paths', 'home.projects': 'projects' } as const;
export const SLOT_IDS = Object.keys(KINDS).filter(id => id.startsWith('home.')) as (keyof StorefrontConfig['content'])[];
export const SLOT_SECTIONS = { 'home.hero': 'hero', 'home.tasks': 'tasks', 'home.starts': 'start', 'home.faq': 'faq', 'home.closing': 'closing', 'home.comparison': 'comparison', 'home.catalogue': 'catalogue', 'home.search': 'hero', 'home.featured': 'featured', 'home.starter': 'starter', 'home.author': 'hero', 'home.story': 'story', 'home.paths': 'paths', 'home.projects': 'projects' } as const;
export const editorControl = 'block w-full rounded-lg border border-sf-muted bg-sf-input px-3 py-2.5 text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent';
export const editorButton = 'min-h-11 rounded-lg border border-sf-border-medium bg-sf-base px-4 py-2 text-sm font-medium hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50';
/** Field-level problems: forbidden angle brackets and the field limit, shown as a live counter
 * instead of the native maxlength that silently cut pasted text (W148-7). */
function useTextError(value: unknown, max: number | string | undefined) {
  const id = useId();
  const t = useTranslations('storefrontEditor');
  const text = typeof value === 'string' ? value : '';
  const limit = typeof max === 'number' ? max : max ? Number(max) : 0;
  const angles = /[<>]/.test(text);
  const tooLong = limit > 0 && text.length > limit;
  const invalid = angles || tooLong;
  const message = angles ? t('forbiddenAngles') : tooLong ? t('tooLong', { max: limit, over: text.length - limit }) : null;
  return {
    invalid,
    describedBy: [message ? `${id}-error` : '', limit ? `${id}-count` : ''].filter(Boolean).join(' ') || undefined,
    nodes: <>
      {message && <span id={`${id}-error`} className="block text-sm text-sf-danger">{message}</span>}
      {limit > 0 && <span id={`${id}-count`} className={`block text-xs font-normal ${tooLong ? 'text-sf-danger' : 'text-sf-muted'}`}>{t('charCount', { count: text.length, max: limit })}</span>}
    </>,
  };
}
function TextInput({ maxLength, ...props }: ComponentProps<'input'>) {
  const error = useTextError(props.value, maxLength);
  return <><input {...props} aria-invalid={error.invalid} aria-describedby={error.describedBy} className={`${props.className} ${error.invalid ? 'border-sf-danger' : ''}`} />{error.nodes}</>;
}
function TextArea({ maxLength, ...props }: ComponentProps<'textarea'>) {
  const error = useTextError(props.value, maxLength);
  return <><textarea {...props} aria-invalid={error.invalid} aria-describedby={error.describedBy} className={`${props.className} ${error.invalid ? 'border-sf-danger' : ''}`} />{error.nodes}</>;
}
function emptyContent(id: SlotId): SlotContent {
  const kind = KINDS[id];
  if (kind === 'author') return { kind, name: '', eyebrow: '', heading: '', intro: '', portraitMediaId: null };
  if (kind === 'biography') return { kind, heading: '', paragraphs: [] };
  if (kind === 'projects') return { kind, heading: '', items: [] };
  if (kind === 'paths') return { kind, heading: '', body: '', items: [] };
  if (kind === 'search') return { kind, heading: '', eyebrow: '', body: '', items: [] };
  if (kind === 'comparison') return { kind, heading: '', body: '', items: [] };
  if (kind === 'faq') return { kind, items: [] };
  if (kind === 'hero') return { kind, heading: '', eyebrow: '', body: '', steps: [] };
  return { kind, heading: '', body: '' };
}
interface SlotEditorProps { taskCategories?: string[]; comparisonProducts?: string[]; id: SlotId; value: (StorefrontConfig['content'] & OfferPageConfig['content'])[SlotId]; onChange: (value: (StorefrontConfig['content'] & OfferPageConfig['content'])[SlotId]) => void }
export default function SlotEditor({ id, value, onChange, comparisonProducts = [], taskCategories = [] }: SlotEditorProps) {
  const t = useTranslations('storefrontEditor');
  const uiLocale = useLocale() === 'pl' ? 'pl' : 'en';
  const [locale, setLocale] = useState<'en' | 'pl'>(value?.[uiLocale] ? uiLocale : value?.sourceLocale ?? uiLocale);
  const section = id === 'offer.hero' ? 'hero' : id === 'offer.faq' ? 'faq' : id === 'offer.closing' ? 'closing' : SLOT_SECTIONS[id];
  const name = id === 'home.author' ? t('authorHero') : id === 'home.search' ? t('search-hero') : t(`sectionNames.${section}`);
  const current = value ?? { sourceLocale: uiLocale, [uiLocale]: emptyContent(id) } as NonNullable<typeof value>;
  const content = current[locale] ?? emptyContent(id);
  const prefix = `${name} · ${locale.toUpperCase()}`;
  const update = (next: SlotContent) => onChange({ ...current, [locale]: next } as NonNullable<typeof value>);
  const textField = (field: 'heading' | 'eyebrow' | 'body', max: number) => {
    if (!(field in content)) return null;
    const props = { className: editorControl, 'aria-label': `${prefix} · ${t(field)}`, maxLength: max, value: String(content[field as keyof typeof content]), onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update({ ...content, [field]: event.target.value }) };
    return <label className="block space-y-2 text-sm font-medium" key={field}><span>{t(field)}</span>{field === 'body' ? <TextArea {...props} rows={4} /> : <TextInput {...props} />}</label>;
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
      {content.kind === 'hero' && <label className="block space-y-2 text-sm font-medium"><span>{t('steps')}</span><TextArea aria-label={`${prefix} · ${t('steps')}`} className={editorControl} rows={3} maxLength={1445} value={content.steps.join('\n')} onChange={event => update({ ...content, steps: event.target.value ? event.target.value.split('\n') : [] })} /></label>}
      {content.kind === 'search' && taskCategories.map((categoryId, index) => <label key={categoryId} className="block space-y-2 text-sm font-medium">
        <span>{t('categoryDescription', { number: index + 1 })}</span><TextArea className={editorControl} maxLength={240} aria-label={`${prefix} · ${t('categoryDescription', { number: index + 1 })}`} value={content.items.find(item => item.categoryId === categoryId)?.description ?? ''} onChange={event => update({ ...content, items: taskCategories.map((id, i) => ({ id: `task-${i + 1}`, categoryId: id, description: id === categoryId ? event.target.value : content.items.find(item => item.categoryId === id)?.description ?? '' })) })} />
      </label>)}
      {content.kind === 'comparison' && comparisonProducts.map((productId, index) => {
        const item = content.items.find(item => item.productId === productId) ?? { productId, eyebrow: '', heading: '', body: '', bullets: [] };
        const change = (patch: Partial<typeof item>) => update({ ...content, items: comparisonProducts.map(id => id === productId ? { ...item, ...patch } : content.items.find(value => value.productId === id) ?? { productId: id, eyebrow: '', heading: '', body: '', bullets: [] }) });
        return <div key={productId} className="space-y-3 rounded-xl border border-sf-border p-4">
          <p>{t('offerNumber', { number: index + 1 })}</p>
          {(['eyebrow', 'heading', 'body'] as const).map(field => <label key={field} className="block space-y-2 text-sm"><span>{t(field)}</span><TextArea className={editorControl} aria-label={`${prefix} · ${index + 1} · ${t(field)}`} maxLength={field === 'body' ? 1000 : field === 'heading' ? 160 : 80} value={item[field]} onChange={event => change({ [field]: event.target.value })} /></label>)}
          <label className="block space-y-2 text-sm"><span>{t('steps')}</span><TextArea className={editorControl} aria-label={`${prefix} · ${index + 1} · ${t('steps')}`} maxLength={1445} value={item.bullets.join('\n')} onChange={event => change({ bullets: event.target.value ? event.target.value.split('\n') : [] })} /></label>
        </div>;
      })}
      {content.kind === 'author' && <>
        <label className="block space-y-2 text-sm font-medium"><span>{t('authorName')}</span><TextInput aria-label={`${prefix} · ${t('authorName')}`} className={editorControl} maxLength={120} value={content.name} onChange={event => update({ ...content, name: event.target.value })} /></label>
        <label className="block space-y-2 text-sm font-medium"><span>{t('authorIntro')}</span><TextArea aria-label={`${prefix} · ${t('authorIntro')}`} className={editorControl} maxLength={4000} rows={4} value={content.intro} onChange={event => update({ ...content, intro: event.target.value })} /></label>
        <BindingPicker label={t('portraitCover')} kind="products" selectedIds={content.portraitMediaId ? [content.portraitMediaId] : []} maxItems={1} onChange={ids => update({ ...content, portraitMediaId: ids[0] ?? null })} />
      </>}
      {content.kind === 'biography' && <>
        {content.paragraphs.map((paragraph, index) => <div key={index} className="space-y-2">
          <label className="block space-y-2 text-sm font-medium"><span>{t('paragraphNumber', { number: index + 1 })}</span><TextArea className={editorControl} rows={4} maxLength={2000} value={paragraph} onChange={event => update({ ...content, paragraphs: content.paragraphs.map((value, i) => i === index ? event.target.value : value) })} /></label>
          <button className={editorButton} type="button" onClick={() => update({ ...content, paragraphs: content.paragraphs.filter((_, i) => i !== index) })}>{t('removeParagraph', { number: index + 1 })}</button>
        </div>)}
        <button className={editorButton} type="button" disabled={content.paragraphs.length >= 6} onClick={() => update({ ...content, paragraphs: [...content.paragraphs, ''] })}>{t('addParagraph')}</button>
      </>}
      {content.kind === 'paths' && <>
        <BindingPicker label={t('pathOffers')} kind="products" selectedIds={content.items.map(item => item.productId)} maxItems={4} onChange={ids => update({ ...content, items: ids.map(productId => content.items.find(item => item.productId === productId) ?? { id: `path-${productId}`, productId, situation: '', body: '' }) })} />
        {content.items.map((item, index) => <div key={item.id} className="space-y-3 rounded-xl border border-sf-border p-4">
          <p className="text-sm font-medium">{t('pathNumber', { number: index + 1 })}</p>
          {(['situation', 'body', 'label'] as const).map(field => <label key={field} className="block space-y-2 text-sm"><span>{t(field === 'label' ? 'pathLabel' : field)}</span><TextArea className={editorControl} maxLength={field === 'body' ? 1000 : field === 'situation' ? 160 : 80} value={item[field] ?? ''} onChange={event => update({ ...content, items: content.items.map((value, i) => i === index ? { ...value, [field]: event.target.value } : value) })} /></label>)}
        </div>)}
      </>}
      {content.kind === 'projects' && <>
        {content.items.map((item, index) => <div key={item.id} className="space-y-3 rounded-xl border border-sf-border p-4">
          <p className="text-sm font-medium">{t('projectNumber', { number: index + 1 })}</p>
          {(['name', 'body', 'url'] as const).map(field => <label key={field} className="block space-y-2 text-sm"><span>{t(field === 'name' ? 'projectName' : field === 'url' ? 'projectUrl' : 'body')}</span><TextInput type={field === 'url' ? 'url' : 'text'} className={editorControl} maxLength={field === 'body' ? 1000 : field === 'url' ? 2048 : 120} value={item[field]} onChange={event => update({ ...content, items: content.items.map((value, i) => i === index ? { ...value, [field]: event.target.value } : value) })} /></label>)}
          <BindingPicker label={t('projectCover')} kind="products" selectedIds={item.mediaId ? [item.mediaId] : []} maxItems={1} onChange={ids => update({ ...content, items: content.items.map((value, i) => i === index ? { ...value, mediaId: ids[0] ?? null } : value) })} />
          <button type="button" className={editorButton} onClick={() => update({ ...content, items: content.items.filter((_, i) => i !== index) })}>{t('removeProject', { number: index + 1 })}</button>
        </div>)}
        <button type="button" className={editorButton} disabled={content.items.length >= 3} onClick={() => {
          let number = 1; while (content.items.some(item => item.id === `project-${number}`)) number++;
          update({ ...content, items: [...content.items, { id: `project-${number}`, name: '', body: '', url: '', mediaId: null }] });
        }}>{t('addProject')}</button>
      </>}
      {content.kind === 'faq' && <>
        {content.items.map((item, index) => <div key={item.id} className="space-y-3 rounded-xl border border-sf-border p-4">
          <label className="block space-y-2 text-sm font-medium"><span>{t('question', { number: index + 1 })}</span><TextInput aria-label={`${prefix} · ${t('question', { number: index + 1 })}`} className={editorControl} maxLength={240} value={item.question} onChange={event => update({ ...content, items: content.items.map((old, i) => i === index ? { ...old, question: event.target.value } : old) })} /></label>
          <label className="block space-y-2 text-sm font-medium"><span>{t('answer', { number: index + 1 })}</span><TextArea aria-label={`${prefix} · ${t('answer', { number: index + 1 })}`} className={editorControl} maxLength={4000} rows={3} value={item.answer} onChange={event => update({ ...content, items: content.items.map((old, i) => i === index ? { ...old, answer: event.target.value } : old) })} /></label>
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
