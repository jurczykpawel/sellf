'use client';
/** Event dates, pricing and order overview. @see @/lib/events/actions */
import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import TutorialHelpButton from '@/components/tutorials/TutorialHelpButton';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';
import { validateWholeAmounts } from '@/lib/validations/product';
import { eventSessionsSchema } from '@/lib/events/schema';
import { getEventAdmin, exportEventParticipants } from '@/lib/events/actions';
import { formatEventDate, participantRows, participantFilename, eventLocalDate, eventUTCDate } from '@/lib/events/presentation';
import type { EventAdminInfo } from '@/lib/events/actions';
import type { EventSessionInput } from '@/lib/events/schema';
import type { Dispatch, SetStateAction } from 'react';
import type { ProductFormData } from '@/components/ProductFormModal/types';
export function EventSection({ formData, setFormData }: { formData: ProductFormData; setFormData: Dispatch<SetStateAction<ProductFormData>> }) {
  const t = useTranslations('events'); const locale = useLocale(); const [info, setInfo] = useState<{ id: string; offset: number; data: EventAdminInfo } | null>(null); const [error, setError] = useState('');
  const sessions = formData.sessions ?? [];
  const update = (values: EventSessionInput[]) => setFormData(p => ({ ...p, sessions: values }));
  const patch = (index: number, values: Partial<EventSessionInput>) => update(sessions.map((s, i) => i === index ? { ...s, ...values } : s));
  const load = async (id: string, offset = 0) => { const r = await getEventAdmin(id, offset); if (r.success && r.data) { setInfo({ id, offset, data: r.data }); setError(''); } else setError(r.error ?? t('error')); };
  const input = (key: string, value: string | number | null | undefined, change: (v: string) => void, type = 'text') => <label className="block text-sm" key={key}>{t(key === 'title' ? 'titleField' : key)}<input className="block w-full rounded border border-sf-border bg-sf-input p-2" type={type} value={value ?? ''} onChange={e => change(e.target.value)} /></label>;
  const dateInput = (key: string, value: string | null | undefined, timezone: string, change: (v: string | null) => void) => input(key, eventLocalDate(value ?? '', timezone), v => change(v ? eventUTCDate(v, timezone) : null), 'datetime-local');
  const buttonClass = 'inline-flex items-center rounded border border-sf-border bg-sf-raised px-4 py-2 text-sm font-medium hover:bg-sf-hover focus-visible:ring-2 focus-visible:ring-sf-accent';
  const valid = eventSessionsSchema.safeParse(sessions);
  return <section className="space-y-4" aria-label={t('title')}><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium text-sf-heading">{t('title')}</h4><TutorialHelpButton id="events" /></div><TutorialTrigger id="events" auto={formData.event_mode === true} />
    <label data-tour="event-enable" className="flex gap-2"><input type="checkbox" checked={formData.event_mode ?? false} disabled={!formData.event_mode && (formData.product_type === 'subscription' || formData.is_bundle || formData.allow_custom_price)} onChange={e => setFormData(p => ({ ...p, event_mode: e.target.checked, ...(e.target.checked ? { allow_repeat_purchase: true } : {}) }))} />{t('enabled')}</label>
    {formData.event_mode && <><label className="flex gap-2"><input type="checkbox" checked={formData.allow_repeat_purchase ?? true} onChange={e => setFormData(p => ({ ...p, allow_repeat_purchase: e.target.checked }))} />{t('repeat')}</label>{sessions.map((s, index) => <fieldset data-tour="event-session" className="rounded-lg border border-sf-border p-4 space-y-3" key={s.id ?? index}><legend>{t('session')} {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">
      {dateInput('starts_at', s.starts_at, s.timezone, v => patch(index, { starts_at: v ?? '' }))}{dateInput('ends_at', s.ends_at, s.timezone, v => patch(index, { ends_at: v }))}
      {(['timezone', 'title', 'venue', 'online_url', 'extra_days'] as const).map(k => input(k, s[k], v => patch(index, { [k]: v || null })))}
      {input('capacity', s.capacity, v => patch(index, { capacity: v ? Number(v) : null }), 'number')}
      {input('sort', s.sort, v => patch(index, { sort: Number(v) }), 'number')}
      <label><input type="checkbox" checked={s.sales_open} onChange={e => patch(index, { sales_open: e.target.checked })} />{t('sales_open')}</label></div>
      {s.tiers.map((tier, n) => <fieldset key={tier.id ?? n} data-tour="event-tier" className="grid gap-3 rounded border border-sf-border p-3 sm:grid-cols-2"><legend>{t('tier')} {n + 1}</legend>
        {(['label', 'price', 'seats', 'sort'] as const).map(k => input(k, tier[k], v => patch(index, { tiers: s.tiers.map((x, j) => j === n ? { ...x, [k]: k === 'label' ? v : v ? Number(v) : k === 'seats' ? null : 0 } : x) }), k === 'label' ? 'text' : 'number'))}
        {dateInput('sale_ends_at', tier.sale_ends_at, s.timezone, v => patch(index, { tiers: s.tiers.map((x,j) => j === n ? { ...x, sale_ends_at: v } : x) }))}
        <button className={`${buttonClass} self-start justify-self-start`} type="button" onClick={() => patch(index, { tiers: s.tiers.filter((_,j) => j !== n) })}>{t('removeTier')}</button></fieldset>)}
      <button data-tour="event-add-tier" className={buttonClass} type="button" onClick={() => patch(index, { tiers: [...s.tiers, { label: '', price: formData.price, seats: null, sort: Math.max(-1,...s.tiers.map(v => v.sort))+1 }] })}>{t('addTier')}</button>
      <button className={`${buttonClass} ml-4`} type="button" onClick={() => update(sessions.filter((_,i) => i !== index))}>{t('removeSession')}</button>
      {s.id ? <button data-tour="event-preview" className={`${buttonClass} ml-4`} type="button" onClick={() => void load(s.id!)}>{t('preview')}</button> : <p>{t('savePreview')}</p>}
    </fieldset>)}<button data-tour="event-add-session" className={buttonClass} type="button" onClick={() => update([...sessions, { starts_at: '', timezone: 'Europe/Warsaw', capacity: null, sales_open: true, sort: sessions.length, tiers: [{ label: '', price: formData.price, seats: null, sort: 0 }] }])}>{t('addSession')}</button>
    {(!valid.success || validateWholeAmounts({ sessions }, formData.currency).length > 0) && <p role="alert" className="text-sf-danger">{t('invalid')}</p>}</>}
    {error && <p role="alert">{error}</p>}
    {info && <section aria-label={t('preview')} className="space-y-3 rounded-lg border border-sf-border p-4"><h4 className="font-medium text-sf-heading">{t('preview')}</h4><p>{info.data.availability.title} · {formatEventDate(info.data.availability.starts_at, info.data.availability.timezone, locale)}</p><p>{info.data.availability.venue} {info.data.availability.extra_days}</p><p>{t('sold')}: {info.data.sold} · {t('held')}: {info.data.held} · {t('remaining')}: {info.data.availability.remaining ?? '∞'}</p>
      {info.data.availability.current_tier ? <><p>{info.data.availability.current_tier.price} {formData.currency}</p>{info.data.availability.current_tier.seats_left !== null && <p>{t('seatsLeft', { count: info.data.availability.current_tier.seats_left })}</p>}{info.data.availability.current_tier.ends_at && <p>{t('until')}: {info.data.availability.current_tier.ends_at}</p>}{info.data.availability.next_tier_price !== null && <p>{t('next')}: {info.data.availability.next_tier_price} {formData.currency}</p>}{info.data.availability.cheaper_sold_out && <p>{t('cheaperSoldOut')}</p>}</> : <p>{t('salesUnavailable')}</p>}
      <h5 className="font-medium text-sf-heading">{t('orders')}</h5><div className="overflow-x-auto"><table><thead><tr>{['order','status','firstName','lastName','participantEmail'].map(k => <th className="p-2" key={k}>{t(k)}</th>)}</tr></thead><tbody>{participantRows(info.data.orders).map((r,i) => <tr key={i}>{r.map((cell,j) => <td className="p-2" key={j}>{j === 1 ? t(`reservationStatus.${cell}`) : cell}</td>)}</tr>)}</tbody></table></div>
      <button className={`${buttonClass} disabled:opacity-50`} type="button" disabled={info.offset === 0} onClick={() => void load(info.id, Math.max(0,info.offset-100))}>{t('previous')}</button><button className={`${buttonClass} ml-4 disabled:opacity-50`} type="button" disabled={info.data.orders.length < 100} onClick={() => void load(info.id,info.offset+100)}>{t('nextPage')}</button>
      <button className={`${buttonClass} ml-4`} type="button" onClick={async () => { const r = await exportEventParticipants(info.id); if (!r.success || !r.data) { setError(r.error ?? t('error')); return; } const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = participantFilename(formData.slug, info.data.availability, t); a.click(); URL.revokeObjectURL(url); }}>{t('export')}</button>
    </section>}
  </section>;
}
