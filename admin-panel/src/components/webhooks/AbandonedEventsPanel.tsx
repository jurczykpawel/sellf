'use client';

/**
 * Business events whose hand-off to webhook delivery failed on every attempt, with a retry
 * per event. Renders nothing while there are none.
 * @see src/app/api/v1/webhooks/events/route.ts
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, isExpectedApiError } from '@/lib/api/client';
import { formatAdminDate } from '@/lib/timezone';

interface AbandonedEvent {
  id: string;
  event_type: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  abandoned_at: string;
}

export default function AbandonedEventsPanel() {
  const t = useTranslations('admin.webhooks.abandonedEvents');
  const locale = useLocale();
  const [events, setEvents] = useState<AbandonedEvent[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.list<AbandonedEvent>('webhooks/events', { status: 'abandoned', limit: 50 });
      setEvents(response.data ?? []);
    } catch (error) {
      if (isExpectedApiError(error)) return;
      console.error('[AbandonedEventsPanel] fetch failed', error);
      toast.error(t('loadError'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await api.postCustom(`webhooks/events/${id}/retry`, {});
      toast.success(t('retrySuccess'));
      await load();
    } catch (error) {
      if (isExpectedApiError(error)) return;
      console.error('[AbandonedEventsPanel] retry failed', error);
      toast.error(t('retryError'));
    } finally {
      setRetrying(null);
    }
  };

  if (!events.length) return null;
  return (
    <section className="border-2 border-sf-danger bg-sf-base p-4 space-y-3" aria-labelledby="abandoned-events-title">
      <div>
        <h2 id="abandoned-events-title" className="text-lg font-semibold text-sf-heading">{t('title')}</h2>
        <p className="text-sm text-sf-muted">{t('description')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sf-border text-left text-sf-muted">
              <th className="p-2">{t('event')}</th>
              <th className="p-2">{t('created')}</th>
              <th className="p-2">{t('abandoned')}</th>
              <th className="p-2">{t('attempts')}</th>
              <th className="p-2">{t('lastError')}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {events.map(event => (
              <tr key={event.id} className="border-b border-sf-border align-top">
                <td className="p-2 font-mono text-xs text-sf-heading">{event.event_type}</td>
                <td className="p-2 whitespace-nowrap">{formatAdminDate(event.created_at, locale)}</td>
                <td className="p-2 whitespace-nowrap">{formatAdminDate(event.abandoned_at, locale)}</td>
                <td className="p-2">{event.attempts}</td>
                <td className="p-2 text-xs text-sf-muted break-all">{event.last_error ?? '—'}</td>
                <td className="p-2">
                  <button type="button" onClick={() => void retry(event.id)} disabled={retrying === event.id}
                    className="px-3 py-1.5 text-xs font-medium border border-sf-border bg-sf-base text-sf-accent hover:bg-sf-hover disabled:opacity-50">
                    {retrying === event.id ? '...' : t('retry')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
