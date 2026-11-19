'use client';

/**
 * Maintenance mode ("Przerwa w działaniu"): the admin switches the database source on and off,
 * with an optional note and expected end, and sees which source is in effect. The server file and
 * SELLF_MAINTENANCE cannot be switched here; the section says where they are and how to end them.
 *
 * @see src/lib/actions/maintenance.ts
 * @see src/lib/maintenance/setting.ts
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getMaintenanceStatus, setMaintenanceMode } from '@/lib/actions/maintenance';
import type { MaintenanceStatus } from '@/lib/maintenance/setting';

/** <input type="datetime-local"
            ref={expectedEndRef}
            aria-invalid={expectedEndError || undefined}
            aria-describedby={expectedEndError ? 'maintenance-end-error' : undefined}> value (local time) for an ISO instant, and back. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function MaintenanceSettings() {
  const t = useTranslations('settings.maintenance');
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [message, setMessage] = useState('');
  const [expectedEnd, setExpectedEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [expectedEndError, setExpectedEndError] = useState(false);
  const expectedEndRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getMaintenanceStatus().then(result => {
      if (!live) return;
      if (result.success && result.data) {
        setStatus(result.data);
        setMessage(result.data.database.message ?? '');
        setExpectedEnd(toLocalInput(result.data.database.expected_end_at));
      } else toast.error(t('error'));
    }).catch(() => { if (live) toast.error(t('error')); });
    return () => { live = false; };
  }, [t]);

  async function change(enabled: boolean) {
    if (enabled && expectedEnd && (!Number.isFinite(Date.parse(expectedEnd)) || Date.parse(expectedEnd) <= Date.now())) {
      setExpectedEndError(true);
      expectedEndRef.current?.focus();
      return;
    }
    setExpectedEndError(false);
    setSaving(true);
    try {
      const result = await setMaintenanceMode({ enabled, message: enabled ? message : null, expected_end_at: enabled ? fromLocalInput(expectedEnd) : null });
      if (result.success && result.data) {
        setStatus(result.data);
        if (!enabled) { setMessage(''); setExpectedEnd(''); }
        toast.success(t(enabled ? 'turnedOn' : 'turnedOff'));
      } else {
        toast.error(result.errorCode === 'INVALID_INPUT' ? t('invalid') : t('error'));
      }
    } catch {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  }

  const databaseOn = status?.database.enabled === true;
  const server = status?.server;

  return (
    <section className="bg-sf-base border-2 border-sf-border-medium p-6" aria-labelledby="maintenance-title" data-testid="maintenance-settings">
      <h2 id="maintenance-title" className="text-xl font-semibold text-sf-heading mb-2">{t('title')}</h2>
      <p className="text-sm text-sf-body mb-1">{t('description')}</p>
      <p className="text-sm text-sf-muted mb-4">{t('keepsWorking')}</p>

      <p role="status" className="font-medium text-sf-heading mb-4" data-testid="maintenance-status">
        {!status ? t('loading') : !status.active ? t('statusOff') : t(`statusOn.${status.source ?? 'database'}`)}
      </p>

      {server?.file_present && (
        <div className="border-l-4 border-sf-warning bg-sf-raised p-4 mb-4 text-sm space-y-2" data-testid="maintenance-file">
          <p>{t(server.file_reason === 'migration_state_unknown' ? 'file.afterFailedUpdate' : server.file_reason === 'upgrade' ? 'file.duringUpdate' : 'file.manual')}</p>
          <p>{t('file.howToEnd')}</p>
          <code className="block break-all bg-sf-base border border-sf-border p-2">rm {server.file_path}</code>
        </div>
      )}
      {server?.env && (
        <div className="border-l-4 border-sf-warning bg-sf-raised p-4 mb-4 text-sm" data-testid="maintenance-env">
          <p>{t('env')}</p>
        </div>
      )}

      <div className="space-y-4">
        <label className="block text-sm font-medium text-sf-body">
          {t('message')}
          <textarea
            className="mt-1 block w-full border border-sf-border bg-sf-base p-2"
            rows={3}
            maxLength={500}
            value={message}
            disabled={!status || saving}
            onChange={event => setMessage(event.target.value)}
          />
          <span className="block text-xs text-sf-muted mt-1">{t('messageHelp')}</span>
        </label>
        <label className="block text-sm font-medium text-sf-body">
          {t('expectedEnd')}
          <input
            type="datetime-local"
            ref={expectedEndRef}
            aria-invalid={expectedEndError || undefined}
            aria-describedby={expectedEndError ? 'maintenance-end-error' : undefined}
            className="mt-1 block border border-sf-border bg-sf-base p-2"
            value={expectedEnd}
            disabled={!status || saving}
            onChange={event => { setExpectedEnd(event.target.value); setExpectedEndError(false); }}
          />
          <span className="block text-xs text-sf-muted mt-1">{t('expectedEndHelp')}</span>
          {expectedEndError && <span id="maintenance-end-error" role="alert" className="block text-xs text-sf-danger mt-1">{t('expectedEndInvalid')}</span>}
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="min-h-11 px-4 border-2 border-sf-border-medium bg-sf-accent-bg text-sf-inverse font-medium disabled:opacity-50"
            disabled={!status || saving}
            onClick={() => change(true)}
          >
            {t(databaseOn ? 'update' : 'turnOn')}
          </button>
          {databaseOn && (
            <button
              type="button"
              className="min-h-11 px-4 border-2 border-sf-border-medium font-medium disabled:opacity-50"
              disabled={saving}
              onClick={() => change(false)}
            >
              {t('turnOff')}
            </button>
          )}
        </div>
        {databaseOn && status?.source !== 'database' && <p className="text-sm text-sf-muted">{t('databaseShadowed')}</p>}
      </div>
    </section>
  );
}
