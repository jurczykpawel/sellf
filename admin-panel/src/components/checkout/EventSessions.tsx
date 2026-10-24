'use client';

/** Session selection shared by product and checkout. @see lib/events/presentation.ts */
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { formatEventDate, formatEventRange } from '@/lib/events/presentation';
import type { EventSession } from '@/lib/events/presentation';

export default function EventSessions({ sessions, currency, selected, onSelect }: {
  sessions: EventSession[]; currency: string; selected: string | null; onSelect: (id: string) => void;
}) {
  const t = useTranslations('events');
  const locale = useLocale();
  return <fieldset className="mb-6 space-y-3" data-testid="event-sessions">
    <legend className="mb-3 text-lg font-semibold">{t('chooseSession')}</legend>
    {!sessions.length && <p role="status">{t('noSessions')}</p>}
    {sessions.map(s => <div key={s.id} className="rounded-xl border border-sf-border p-4">
      <label className="flex items-start gap-3">
        {s.currentTier && !s.soldOut && <input type="radio" name="event-session" value={s.id} checked={s.id === selected} onChange={() => onSelect(s.id)} className="mt-1" />}
        <span>{s.title && <strong className="block">{s.title}</strong>}<time dateTime={s.startsAt}>{formatEventRange(s.startsAt, s.endsAt, s.timezone, locale)}</time></span>
      </label>
      {s.venue && <p>{s.venue}</p>}{s.extraDays && <p>{s.extraDays}</p>}
      {s.soldOut ? <p role="status">{t('soldOut')}</p> : !s.currentTier ? <p>{t('unavailable')}</p> : <>
        <p className="font-semibold">{formatPrice(s.currentTier.price, currency, locale)}</p>
        {s.currentTier.seatsLeft !== null && <p>{t('seatsLeft', { count: s.currentTier.seatsLeft })}</p>}
        {s.currentTier.endsAt && <p>{t('priceUntil', { date: formatEventDate(s.currentTier.endsAt, s.timezone, locale) })}</p>}
        {s.nextTierPrice !== null && <p>{t('nextPrice', { price: formatPrice(s.nextTierPrice, currency, locale) })}</p>}
        {s.cheaperSoldOut && <p>{t('cheaperSoldOut')}</p>}
      </>}
    </div>)}
  </fieldset>;
}
