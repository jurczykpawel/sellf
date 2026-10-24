'use client';

/** Profile UI uses the same values as the server module registry. @see lib/checkout-modules/registry.ts */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EU_COUNTRIES } from '@/lib/checkout/eu-countries';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import type { ReactNode } from 'react';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { FieldError } from '@/lib/checkout-modules/registry';
import type { UseInvoiceDataReturn } from '@/hooks/useInvoiceData';

interface Person { first_name: string; last_name: string; email: string }
interface Party { company_name: string; nip: string; address: string; city: string; postal_code: string; country: string }
const emptyParty: Party = { company_name: '', nip: '', address: '', city: '', postal_code: '', country: 'PL' };

export function useCheckoutProfileValues(profile: CheckoutProfile | null, invoice: UseInvoiceDataReturn, email: string, quantity: number) {
  const [errors, setErrors] = useState<FieldError[]>([]);
  const buyerConfig = profile?.modules.find(module => module.id === 'buyer');
  const [buyerType, setBuyerType] = useState<'person' | 'organization'>(buyerConfig?.types[0] ?? 'person');
  const [names, setNames] = useState<Partial<Person>>({});
  const [differs, setDiffers] = useState(false);
  const [recipient, setRecipient] = useState<Party>(emptyParty);
  const [phone, setPhone] = useState('');
  const [participants, setParticipants] = useState<Record<number, Partial<Person>>>({});
  const [includeParticipants, setIncludeParticipants] = useState(false);
  const words = invoice.fullName.trim().split(/\s+/);
  const person = { first_name: names.first_name ?? words[0] ?? '', last_name: names.last_name ?? words.slice(1).join(' '), email };
  const party: Party = { company_name: invoice.companyName, nip: invoice.nip, address: invoice.address, city: invoice.city, postal_code: invoice.postalCode, country: invoice.country };
  const participantConfig = profile?.modules.find(module => module.id === 'participants');
  const people = Array.from({ length: quantity }, (_, index) => ({
    ...(quantity === 1 && participantConfig?.prefill_from_buyer ? person : { first_name: '', last_name: '', email: '' }),
    ...participants[index],
  }));
  const values: Record<string, unknown> = {};
  for (const config of profile?.modules ?? []) {
    switch (config.id) {
      case 'buyer': values.buyer = buyerType === 'person' ? { type: buyerType, ...person } : { type: buyerType, ...party, email, ...(person.first_name ? { first_name: person.first_name } : {}), ...(person.last_name ? { last_name: person.last_name } : {}) }; break;
      case 'recipient': values.recipient = buyerType === 'organization' && differs ? { differs: true, ...recipient } : { differs: false }; break;
      case 'phone': values.phone = phone; break;
      case 'quantity': values.quantity = quantity; break;
      case 'participants': values.participants = config.required || includeParticipants ? people : []; break;
    }
  }
  const validate = () => {
    if (!profile) return true;
    const result = validateModuleValues(profile, values, { locale: 'en', currency: '', quantity });
    setErrors(result.success ? [] : result.errors);
    return result.success;
  };
  return { validate, errors, setErrors, values, buyerType, setBuyerType, person, setNames, party, differs, setDiffers, recipient, setRecipient, phone, setPhone, people, setParticipants, includeParticipants, setIncludeParticipants };
}

type ModuleConfig = CheckoutProfile['modules'][number];
type ProfileFormState = ReturnType<typeof useCheckoutProfileValues>;
interface Props { profile: CheckoutProfile; state: ProfileFormState; invoice: UseInvoiceDataReturn; errors: FieldError[]; disabled: boolean }
export default function CheckoutProfileFields({ profile, state, invoice, errors, disabled }: Props) {
  const t = useTranslations('checkout.profile');
  useEffect(() => {
    if (errors.length && !disabled) {
      const first = document.getElementById(errors[0].field) ?? document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus({ preventScroll: true });
    }
  }, [errors, disabled]);
  const inputClass = 'w-full rounded-lg border border-sf-border bg-sf-input px-3 py-2.5 text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent';
  const errorText = (field: string) => {
    const error = errors.find(error => error.field === field);
    return error ? error.maximum ? t('errors.tooLong', { max: error.maximum }) : t(`errors.${t.has(`errors.${error.code}`) ? error.code : 'invalid'}`) : null;
  };
  const field = (id: string, label: string, value: string, onChange: (value: string) => void, type = 'text', onBlur?: () => void) => (
    <div key={id}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-sf-body">{label}</label>
      {id.endsWith('.country') ? <select id={id} value={value} disabled={disabled} className={inputClass} onChange={event => onChange(event.target.value)}>
        {EU_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
      </select> : <input id={id} type={type} value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur}
        disabled={disabled} className={errorText(id) ? inputClass.replace('border-sf-border', 'border-sf-danger') : inputClass} aria-invalid={!!errorText(id)} aria-describedby={errorText(id) ? `${id}-error` : undefined} />}
      {errorText(id) && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-sf-danger">{errorText(id)}</p>}
    </div>
  );
  const personFields = (prefix: string, person: Person, update: (key: keyof Person, value: string) => void, includeEmail: boolean) =>
    (includeEmail ? ['first_name', 'last_name', 'email'] as const : ['first_name', 'last_name'] as const).map(key =>
      field(`${prefix}.${key}`, t(key), person[key], value => update(key, value), key === 'email' ? 'email' : 'text'));
  const partyFields = (prefix: string, party: Party, update: (key: keyof Party, value: string) => void, gus = false) =>
    (['company_name', 'nip', 'address', 'postal_code', 'city', 'country'] as const).map(key =>
      field(`${prefix}.${key}`, t(key), party[key], value => update(key, value), 'text', key === 'nip' && gus ? invoice.handleNIPBlur : undefined));
  const buyerSetters = { company_name: invoice.setCompanyName, nip: invoice.setNip, address: invoice.setAddress, city: invoice.setCity, postal_code: invoice.setPostalCode, country: invoice.setCountry };
  const forms: Record<Exclude<ModuleConfig['id'], 'quantity'>, (config: ModuleConfig) => ReactNode> = {
    buyer: config => config.id === 'buyer' && <>
        <label className="block text-sm text-sf-body" htmlFor="buyer.type">{t('buyerType')}</label>
        <select id="buyer.type" value={state.buyerType} className={inputClass} onChange={event => state.setBuyerType(event.target.value as 'person' | 'organization')}>
          {config.types.map(type => <option key={type} value={type}>{t(type)}</option>)}
        </select>
        {personFields('buyer', state.person, (key, value) => state.setNames(previous => ({ ...previous, [key]: value })), false)}
        {state.buyerType === 'organization' && <>
          {partyFields('buyer', state.party, (key, value) => buyerSetters[key](value), config.gus)}
          {config.gus && invoice.isLoadingGUS && <p role="status">{t('loadingCompany')}</p>}
          {config.gus && invoice.gusError && <p role="alert" className="text-sm text-sf-danger">{invoice.gusError}</p>}
        </>}
      </>,
    recipient: () => <>
        <label className="flex items-center gap-2 text-sf-body"><input type="checkbox" checked={state.differs} onChange={event => state.setDiffers(event.target.checked)} />{t('differs')}</label>
        {state.differs && partyFields('recipient', state.recipient, (key, value) => state.setRecipient(previous => ({ ...previous, [key]: value })))}
      </>,
    phone: () => field('phone', t('phone'), state.phone, state.setPhone, 'tel'),
    participants: config => config.id === 'participants' && <>
        {!config.required && <label className="flex items-center gap-2 text-sf-body"><input type="checkbox" checked={state.includeParticipants} onChange={event => state.setIncludeParticipants(event.target.checked)} />{t('includeParticipants')}</label>}
        {(config.required || state.includeParticipants) && state.people.map((person, index) => <div key={index} className="space-y-3 border-t border-sf-border pt-3">
          <p className="text-sm font-medium text-sf-body">{t('participant', { number: index + 1 })}</p>
          {personFields(`participants.${index}`, person, (key, value) => state.setParticipants(previous => ({ ...previous, [index]: { ...previous[index], [key]: value } })), true)}
        </div>)}
      </>,
  };
  return <div className="space-y-6">{profile.modules.map(config => {
    if (config.id === 'quantity' || (config.id === 'recipient' && state.buyerType !== 'organization')) return null;
    return <fieldset key={config.id} disabled={disabled} className="space-y-3 rounded-xl border border-sf-border p-4">
      <legend className="px-1 font-semibold text-sf-heading">{t(config.id)}</legend>
      {config.id !== 'phone' && errorText(config.id) && <p role="alert" className="text-sm text-sf-danger">{errorText(config.id)}</p>}
      {forms[config.id](config)}
    </fieldset>;
  })}</div>;
}

export function CheckoutQuantityField({ config, value, onChange, invalid }: { config: Extract<CheckoutProfile['modules'][number], { id: 'quantity' }>; value: string; onChange: (value: string) => void; invalid: boolean }) {
  const t = useTranslations('checkout.profile');
  return <div className="mb-4">
    <label htmlFor="checkoutQuantity" className="mb-1 block text-sm font-medium text-sf-body">{t('quantity')}</label>
    <input id="checkoutQuantity" className={`w-full rounded-lg border ${invalid ? 'border-sf-danger' : 'border-sf-border'} bg-sf-input px-3 py-2.5 text-sf-heading`}
      type="text" inputMode="numeric" value={value} required aria-invalid={invalid} aria-describedby={invalid ? 'checkoutQuantity-error' : undefined} onChange={event => onChange(event.target.value)} />
    {invalid && <p id="checkoutQuantity-error" role="alert" className="mt-1 text-sm text-sf-danger">{t('errors.invalid')} ({config.min}–{config.max})</p>}
  </div>;
}
