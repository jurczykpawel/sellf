'use client';
/** Event dates, pricing and order overview. @see @/lib/events/actions */
import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import TutorialHelpButton from '@/components/tutorials/TutorialHelpButton';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';
import { currencyExponent } from '@/lib/currency/minor-units';
import { EVENT_LIST_ERROR, EVENT_LIST_MAX, eventFieldErrors, isEventCompatible } from '@/lib/events/schema';
import { getEventAdmin, exportEventParticipants } from '@/lib/events/actions';
import { formatEventDate, participantRows, participantFilename, eventLocalDate, eventUTCDate } from '@/lib/events/presentation';
import type { EventAdminInfo } from '@/lib/events/actions';
import type { EventSessionInput } from '@/lib/events/schema';
import type { Dispatch, SetStateAction } from 'react';
import type { ProductFormData } from '@/components/ProductFormModal/types';
/** `showErrors` (after a refused save) shows every field message, not only those of fields the seller has left. */
export function EventSection({ formData, setFormData, showErrors = false }: { formData: ProductFormData; setFormData: Dispatch<SetStateAction<ProductFormData>>; showErrors?: boolean }) {
  const t = useTranslations('events'); const locale = useLocale(); const [info, setInfo] = useState<{ id: string; offset: number; data: EventAdminInfo } | null>(null); const [error, setError] = useState(''); const [touched, setTouched] = useState<Set<string>>(new Set());
  const sessions = formData.sessions ?? [];
  const update = (values: EventSessionInput[]) => setFormData(p => ({ ...p, sessions: values }));
  const patch = (index: number, values: Partial<EventSessionInput>) => update(sessions.map((s, i) => i === index ? { ...s, ...values } : s));
  const load = async (id: string, offset = 0) => { const r = await getEventAdmin(id, offset); if (r.success && r.data) { setInfo({ id, offset, data: r.data }); setError(''); } else setError(r.error ?? t('error')); };
  const fieldErrors = { ...wholeAmountErrors(sessions, formData.currency), ...eventFieldErrors(sessions) };
  // Field messages appear once the seller leaves the field (B8/B3), never mid-typing; a refused save shows them all.
  const shown = (path?: string) => !!path && (showErrors || touched.has(path)) && !!fieldErrors[path];
  const fieldError = (path: string) => shown(path) ? <span role="alert" className="block text-xs text-sf-danger">{t(`errors.${fieldErrors[path]}`)}</span> : null;
  // A whole list is wrong (no tiers, too many sessions): the message and focus go to the button that repairs it.
  const listErrorId = (path: string) => `event-error-${path.replace(/\./g, '-')}`;
  const listError = (path: string) => showErrors && fieldErrors[path] ? <p id={listErrorId(path)} role="alert" className="text-xs text-sf-danger">{t(`errors.${fieldErrors[path]}`)}</p> : null;
  const listInvalid = (path: string, at = true) => showErrors && at && !!fieldErrors[path] ? { 'aria-invalid': true as const, 'aria-describedby': listErrorId(path) } : {};
  // Too long a list: the first entry over the limit carries the message on its remove button.
  const overLimit = (index: number, length = sessions.length) => index === EVENT_LIST_MAX && length > EVENT_LIST_MAX;
  const input = (key: string, value: string | number | null | undefined, change: (v: string) => void, type = 'text', path?: string) => <label className="block text-sm" key={key}>{t(key === 'title' ? 'titleField' : key)}<input className="block w-full rounded border border-sf-border bg-sf-input p-2" type={type} value={value ?? ''} aria-invalid={shown(path) ? true : undefined} onBlur={() => path && setTouched(p => new Set(p).add(path))} onChange={e => change(e.target.value)} />{path && fieldError(path)}</label>;
  const dateInput = (key: string, value: string | null | undefined, timezone: string, change: (v: string | null) => void, path?: string) => input(key, eventLocalDate(value ?? '', timezone), v => change(v ? eventUTCDate(v, timezone) : null), 'datetime-local', path);
  const buttonClass = 'inline-flex items-center rounded border border-sf-border bg-sf-raised px-4 py-2 text-sm font-medium hover:bg-sf-hover focus-visible:ring-2 focus-visible:ring-sf-accent';
  // Event mode cannot be switched on for these products; the tutorial would ask for an impossible click (W148-3).
  const unavailable = !formData.event_mode && (formData.product_type === 'subscription' || !!formData.is_bundle || !!formData.allow_custom_price);
  // Switched on earlier, but the product changed since: saving is refused until one of them changes.
  const incompatible = !isEventCompatible(formData);
  return <section className="space-y-4" aria-label={t('title')}><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium text-sf-heading">{t('title')}</h4>{!unavailable && <TutorialHelpButton id="events" />}</div>{!unavailable && <TutorialTrigger id="events" auto={formData.event_mode === true} />}
    <label data-tour="event-enable" className="flex gap-2"><input type="checkbox" checked={formData.event_mode ?? false} disabled={unavailable} aria-invalid={incompatible ? true : undefined} aria-describedby={unavailable || incompatible ? 'event-mode-unavailable' : undefined} onChange={e => setFormData(p => ({ ...p, event_mode: e.target.checked, ...(e.target.checked ? { allow_repeat_purchase: true } : {}) }))} />{t('enabled')}</label>
    {(unavailable || incompatible) && <p id="event-mode-unavailable" role={incompatible ? 'alert' : undefined} className={`text-sm ${incompatible ? 'text-sf-danger' : 'text-sf-muted'}`}>{t('modeUnavailable')}</p>}
    {formData.event_mode && <><label className="flex gap-2"><input type="checkbox" checked={formData.allow_repeat_purchase ?? true} onChange={e => setFormData(p => ({ ...p, allow_repeat_purchase: e.target.checked }))} />{t('repeat')}</label>{sessions.map((s, index) => <fieldset data-tour="event-session" className="rounded-lg border border-sf-border p-4 space-y-3" key={s.id ?? index}><legend>{t('session')} {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">
      {dateInput('starts_at', s.starts_at, s.timezone, v => patch(index, { starts_at: v ?? '' }), `${index}.starts_at`)}{dateInput('ends_at', s.ends_at, s.timezone, v => patch(index, { ends_at: v }), `${index}.ends_at`)}
      {(['timezone', 'title', 'venue', 'online_url', 'extra_days'] as const).map(k => input(k, s[k], v => patch(index, { [k]: v || null }), 'text', `${index}.${k}`))}
      {input('capacity', s.capacity, v => patch(index, { capacity: v ? Number(v) : null }), 'number', `${index}.capacity`)}
      {input('sort', s.sort, v => patch(index, { sort: Number(v) }), 'number', `${index}.sort`)}
      <label><input type="checkbox" checked={s.sales_open} onChange={e => patch(index, { sales_open: e.target.checked })} />{t('sales_open')}</label></div>
      {s.tiers.map((tier, n) => <fieldset key={tier.id ?? n} data-tour="event-tier" className="grid gap-3 rounded border border-sf-border p-3 sm:grid-cols-2"><legend>{t('tier')} {n + 1}</legend>
        {(['label', 'price', 'seats', 'sort'] as const).map(k => input(k, tier[k], v => patch(index, { tiers: s.tiers.map((x, j) => j === n ? { ...x, [k]: k === 'label' ? v : v ? Number(v) : k === 'seats' ? null : 0 } : x) }), k === 'label' ? 'text' : 'number', `${index}.tiers.${n}.${k}`))}
        {dateInput('sale_ends_at', tier.sale_ends_at, s.timezone, v => patch(index, { tiers: s.tiers.map((x,j) => j === n ? { ...x, sale_ends_at: v } : x) }), `${index}.tiers.${n}.sale_ends_at`)}
        {overLimit(n, s.tiers.length) && listError(`${index}.tiers`)}
        <button className={`${buttonClass} self-start justify-self-start`} type="button" {...listInvalid(`${index}.tiers`, overLimit(n, s.tiers.length))} onClick={() => patch(index, { tiers: s.tiers.filter((_,j) => j !== n) })}>{t('removeTier')}</button></fieldset>)}
      {s.tiers.length <= EVENT_LIST_MAX && listError(`${index}.tiers`)}
      <button data-tour="event-add-tier" className={buttonClass} type="button" {...listInvalid(`${index}.tiers`, s.tiers.length <= EVENT_LIST_MAX)} onClick={() => patch(index, { tiers: [...s.tiers, { label: '', price: formData.price, seats: null, sort: Math.max(-1,...s.tiers.map(v => v.sort))+1 }] })}>{t('addTier')}</button>
      {overLimit(index) && listError(EVENT_LIST_ERROR)}
      <button className={`${buttonClass} ml-4`} type="button" {...listInvalid(EVENT_LIST_ERROR, overLimit(index))} onClick={() => update(sessions.filter((_,i) => i !== index))}>{t('removeSession')}</button>
      {s.id ? <button data-tour="event-preview" className={`${buttonClass} ml-4`} type="button" onClick={() => void load(s.id!)}>{t('preview')}</button> : <p>{t('savePreview')}</p>}
    </fieldset>)}{sessions.length <= EVENT_LIST_MAX && listError(EVENT_LIST_ERROR)}<button data-tour="event-add-session" className={buttonClass} type="button" {...listInvalid(EVENT_LIST_ERROR, sessions.length <= EVENT_LIST_MAX)} onClick={() => update([...sessions, { starts_at: '', timezone: 'Europe/Warsaw', capacity: null, sales_open: true, sort: sessions.length, tiers: [{ label: '', price: formData.price, seats: null, sort: 0 }] }])}>{t('addSession')}</button>
    {Object.keys(fieldErrors).length > 0 && <p role="alert" className="text-sf-danger">{t('invalid')}</p>}</>}
    {error && <p role="alert">{error}</p>}
    {info && <section aria-label={t('preview')} className="space-y-3 rounded-lg border border-sf-border p-4"><h4 className="font-medium text-sf-heading">{t('preview')}</h4><p>{info.data.availability.title} · {formatEventDate(info.data.availability.starts_at, info.data.availability.timezone, locale)}</p><p>{info.data.availability.venue} {info.data.availability.extra_days}</p><p>{t('sold')}: {info.data.sold} · {t('held')}: {info.data.held} · {t('remaining')}: {info.data.availability.remaining ?? '∞'}</p>
      {info.data.availability.current_tier ? <><p>{info.data.availability.current_tier.price} {formData.currency}</p>{info.data.availability.current_tier.seats_left !== null && <p>{t('seatsLeft', { count: info.data.availability.current_tier.seats_left })}</p>}{info.data.availability.current_tier.ends_at && <p>{t('until')}: {info.data.availability.current_tier.ends_at}</p>}{info.data.availability.next_tier_price !== null && <p>{t('next')}: {info.data.availability.next_tier_price} {formData.currency}</p>}{info.data.availability.cheaper_sold_out && <p>{t('cheaperSoldOut')}</p>}</> : <p>{t('salesUnavailable')}</p>}
      <h5 className="font-medium text-sf-heading">{t('orders')}</h5><div className="overflow-x-auto"><table><thead><tr>{['order','status','firstName','lastName','participantEmail'].map(k => <th className="p-2" key={k}>{t(k)}</th>)}</tr></thead><tbody>{participantRows(info.data.orders).map((r,i) => <tr key={i}>{r.map((cell,j) => <td className="p-2" key={j}>{j === 1 ? t(`reservationStatus.${cell}`) : cell}</td>)}</tr>)}</tbody></table></div>
      <button className={`${buttonClass} disabled:opacity-50`} type="button" disabled={info.offset === 0} onClick={() => void load(info.id, Math.max(0,info.offset-100))}>{t('previous')}</button><button className={`${buttonClass} ml-4 disabled:opacity-50`} type="button" disabled={info.data.orders.length < 100} onClick={() => void load(info.id,info.offset+100)}>{t('nextPage')}</button>
      <button className={`${buttonClass} ml-4`} type="button" onClick={async () => { const r = await exportEventParticipants(info.id); if (!r.success || !r.data) { setError(r.error ?? t('error')); return; } const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = participantFilename(formData.slug, info.data.availability, t); a.click(); URL.revokeObjectURL(url); }}>{t('export')}</button>
    </section>}
  </section>;
}

/** Tier prices with a fraction in a currency without minor units (e.g. JPY), keyed like `eventFieldErrors`. */
function wholeAmountErrors(sessions: EventSessionInput[], currency: string | undefined): Record<string, string> {
  if (!currency || currencyExponent(currency) !== 0) return {};
  const out: Record<string, string> = {};
  sessions.forEach((s, index) => s.tiers.forEach((tier, n) => {
    if (typeof tier.price === 'number' && !Number.isInteger(tier.price)) out[`${index}.tiers.${n}.price`] = 'tier_price_whole';
  }));
  return out;
}
