'use client';
/** Purchased event details. @see @/lib/events/actions */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getMyEventSessions } from '@/lib/events/actions';
import type { PurchasedEvent } from '@/lib/events/presentation';
export default function EventAccess({ productId }: { productId: string }) {
  const [events, setEvents] = useState<PurchasedEvent[]>([]); const t = useTranslations('events'); const locale = useLocale();
  useEffect(() => { let active = true; void getMyEventSessions(productId).then(rows => { if (active) setEvents(rows); }); return () => { active = false; }; }, [productId]);
  return <>{events.map(e => <section key={e.id} className="mb-6 rounded-xl border border-sf-border p-5"><h2>{e.title}</h2><p>{new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: e.timezone }).format(new Date(e.starts_at))} ({e.timezone})</p>{e.online_url?.startsWith('https://') && <a className="text-sf-accent underline" href={e.online_url}>{t('join')}</a>}</section>)}</>;
}
