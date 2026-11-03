'use client';

/** Buyer form for the participant list after payment. @see app/api/orders/participants/route.ts */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ParticipantsEditor from '@/components/checkout/ParticipantsEditor';
import type { ImportedPerson } from '@/lib/checkout-modules/participants-import';

interface ServerError { field: string; code: string }
export default function ParticipantsLaterForm({ orderId, token, quantity }: { orderId: string; token?: string; quantity: number }) {
  const t = useTranslations('participantsLater'), p = useTranslations('checkout.profile');
  const [people, setPeople] = useState<ImportedPerson[]>(() => Array.from({ length: quantity }, () => ({ first_name: '', last_name: '', email: '' })));
  const [errors, setErrors] = useState<ServerError[]>([]);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const errorText = (field: string) => {
    const found = errors.find(error => error.field === field);
    return found ? p(`errors.${p.has(`errors.${found.code}`) ? found.code : 'invalid'}`) : null;
  };
  async function submit() {
    setState('busy'); setErrors([]);
    try {
      const response = await fetch('/api/orders/participants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, ...(token ? { token } : {}), people }) });
      if (response.ok) { setState('done'); return; }
      const body = await response.json().catch(() => ({}));
      setErrors(body.errors ?? (body.code ? [{ field: 'participants', code: body.code }] : []));
      setState('failed');
    } catch { setState('failed'); }
  }
  if (state === 'done') return <p role="status" className="rounded-xl border border-sf-border p-4">{t('saved')}</p>;
  const general = errors.find(error => error.field === 'participants');
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <ParticipantsEditor people={people} required allowLater={false} later={false} setLater={() => {}} includeParticipants setIncludeParticipants={() => {}}
      update={(index, key, value) => setPeople(previous => previous.map((person, i) => i === index ? { ...person, [key]: value } : person))}
      fill={rows => setPeople(previous => previous.map((person, i) => rows[i] ?? person))} errorText={errorText}
      inputClass="w-full rounded-lg border border-sf-border bg-sf-input px-3 py-2.5 text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent" />
    {general && <p role="alert" className="text-sf-danger">{p(`errors.${p.has(`errors.${general.code}`) ? general.code : 'invalid'}`)}</p>}
    {state === 'failed' && !errors.length && <p role="alert" className="text-sf-danger">{t('failed')}</p>}
    <button disabled={state === 'busy'} className="rounded-lg bg-sf-accent-bg px-4 py-3 text-sf-inverse disabled:opacity-60">{t('submit')}</button>
  </form>;
}
