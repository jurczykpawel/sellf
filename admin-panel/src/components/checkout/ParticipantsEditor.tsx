'use client';

/**
 * Compact participant list for checkout: one row per person, paste a list, import CSV, or add later.
 * @see lib/checkout-modules/participants.ts
 * @see lib/checkout-modules/participants-import.ts
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parseParticipantList } from '@/lib/checkout-modules/participants-import';
import type { ImportedPerson } from '@/lib/checkout-modules/participants-import';

type Key = keyof ImportedPerson;
const KEYS: Key[] = ['first_name', 'last_name', 'email'];
export interface ParticipantsEditorProps {
  people: ImportedPerson[];
  required: boolean;
  allowLater: boolean;
  later: boolean;
  setLater: (value: boolean) => void;
  includeParticipants: boolean;
  setIncludeParticipants: (value: boolean) => void;
  update: (index: number, key: Key, value: string) => void;
  fill: (rows: ImportedPerson[]) => void;
  errorText: (field: string) => string | null;
  inputClass: string;
}

export default function ParticipantsEditor(props: ParticipantsEditorProps) {
  const t = useTranslations('checkout.profile');
  const uid = useId();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const quantity = props.people.length;
  const showRows = props.required && props.allowLater && props.later ? false : props.required || props.includeParticipants;
  const apply = (source: string) => {
    const result = parseParticipantList(source, quantity);
    if (result.people.length === 0) { setMessage(t('importNone')); return; }
    props.fill(result.people);
    const extra = [result.skipped ? t('importSkipped', { count: result.skipped }) : '', result.overflow ? t('importOverflow', { count: result.overflow }) : ''].filter(Boolean).join(' ');
    setMessage(`${t('importDone', { count: result.people.length, total: quantity })} ${extra}`.trim());
  };
  const small = 'w-full rounded-lg border px-3 py-2 text-sm text-sf-heading bg-sf-input focus:outline-none focus:ring-2 focus:ring-sf-accent';
  return <>
    {!props.required && <label className="flex items-center gap-2 text-sf-body"><input type="checkbox" checked={props.includeParticipants} onChange={event => props.setIncludeParticipants(event.target.checked)} />{t('includeParticipants')}</label>}
    {props.required && props.allowLater && <label className="flex items-center gap-2 text-sf-body"><input type="checkbox" checked={props.later} onChange={event => props.setLater(event.target.checked)} />{t('later')}</label>}
    {props.required && props.allowLater && props.later && <p className="text-sm text-sf-muted">{t('laterHelp')}</p>}
    {showRows && <>
      {quantity > 1 && <div className="space-y-2 rounded-lg bg-sf-raised p-3">
        <label htmlFor={`${uid}-paste`} className="block text-sm font-medium text-sf-body">{t('pasteLabel')}</label>
        <textarea id={`${uid}-paste`} rows={3} value={text} onChange={event => setText(event.target.value)} aria-describedby={`${uid}-paste-help`} placeholder="Jan, Nowak, jan@example.com" className={`${props.inputClass} font-mono text-sm`} />
        <p id={`${uid}-paste-help`} className="text-xs text-sf-muted">{t('pasteHelp')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => apply(text)} disabled={!text.trim()} className="rounded-lg border border-sf-border px-3 py-2 text-sm font-medium text-sf-heading disabled:opacity-50">{t('pasteApply')}</button>
          <label className="cursor-pointer rounded-lg border border-sf-border px-3 py-2 text-sm font-medium text-sf-heading focus-within:ring-2 focus-within:ring-sf-accent">
            {t('importCsv')}
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={async event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) apply(await file.text());
            }} />
          </label>
        </div>
        {message && <p role="status" className="text-sm text-sf-body">{message}</p>}
      </div>}
      <ol className="space-y-3">
        {props.people.map((person, index) => <li key={index} className="grid grid-cols-2 gap-2 border-t border-sf-border pt-3 sm:grid-cols-[2.5rem_1fr_1fr_1.6fr] sm:items-start">
          <span className="col-span-2 text-sm font-medium text-sf-body sm:col-span-1 sm:pt-2" aria-hidden="true">{index + 1}.</span>
          {KEYS.map(key => {
            const id = `participants.${index}.${key}`;
            const error = props.errorText(id);
            return <div key={key} className={key === 'email' ? 'col-span-2 sm:col-span-1' : ''}>
              <label htmlFor={id} className="sr-only">{t('participant', { number: index + 1 })}: {t(key)}</label>
              <input id={id} type={key === 'email' ? 'email' : 'text'} value={person[key]} placeholder={t(key)} autoComplete="off" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
                onChange={event => props.update(index, key, event.target.value)} className={`${small} ${error ? 'border-sf-danger' : 'border-sf-border'}`} />
              {error && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-sf-danger">{error}</p>}
            </div>;
          })}
        </li>)}
      </ol>
    </>}
  </>;
}
