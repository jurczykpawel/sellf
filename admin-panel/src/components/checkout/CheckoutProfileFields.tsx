'use client';

/**
 * Profile UI uses the same values as the server module registry. The organization buyer and the
 * recipient use the standard checkout invoice section: same fields, rules and messages.
 * @see lib/checkout-modules/registry.ts
 * @see components/checkout/InvoiceSection.tsx
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import { useInvoiceSection } from '@/hooks/useInvoiceSection';
import InvoiceSection from '@/components/checkout/InvoiceSection';
import ParticipantsEditor from '@/components/checkout/ParticipantsEditor';
import type { ReactNode } from 'react';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { FieldError } from '@/lib/checkout-modules/registry';
import type { UseInvoiceDataReturn } from '@/hooks/useInvoiceData';

interface Person { first_name: string; last_name: string; email: string }
const noopSubscribe = () => () => {};
function useProfileInteractive(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
/** Module party fields → invoice section fields (the number is `nip` in the module, `tax_id` in the section). */
const SECTION_FIELD: Record<string, string> = {
  'buyer.nip': 'invoice.tax_id', 'buyer.company_name': 'invoice.company_name', 'buyer.address': 'invoice.address',
  'buyer.postal_code': 'invoice.postal_code', 'buyer.city': 'invoice.city', 'buyer.country': 'invoice.country',
  'recipient.nip': 'recipient.tax_id',
};
const toSectionErrors = (errors: FieldError[]) => errors
  .map(error => ({ field: SECTION_FIELD[error.field] ?? error.field, code: error.code }))
  .filter(error => error.field.startsWith('invoice.') || error.field.startsWith('recipient.'));

export function useCheckoutProfileValues(profile: CheckoutProfile | null, invoice: UseInvoiceDataReturn, email: string, quantity: number) {
  const [errors, setErrorsState] = useState<FieldError[]>([]);
  const buyerConfig = profile?.modules.find(module => module.id === 'buyer');
  const [buyerType, setBuyerType] = useState<'person' | 'organization'>(buyerConfig?.types[0] ?? 'person');
  const [names, setNames] = useState<Partial<Person>>({});
  const invoiceSection = useInvoiceSection({
    recipientEnabled: !!profile?.modules.some(module => module.id === 'recipient'),
    initialWant: true,
    prefill: invoice.nip || invoice.companyName
      ? { taxId: invoice.nip, companyName: invoice.companyName, address: invoice.address, postalCode: invoice.postalCode, city: invoice.city, country: invoice.country }
      : null,
  });
  const { applyServerErrors } = invoiceSection;
  // Module errors (client gate or server 422) also land on the invoice section fields.
  const setErrors = useCallback((list: FieldError[]) => { setErrorsState(list); applyServerErrors(toSectionErrors(list)); }, [applyServerErrors]);
  const [phone, setPhone] = useState('');
  const [participants, setParticipants] = useState<Record<number, Partial<Person>>>({});
  const [includeParticipants, setIncludeParticipants] = useState(false);
  const [later, setLater] = useState(false);
  const words = invoice.fullName.trim().split(/\s+/);
  const person = { first_name: names.first_name ?? words[0] ?? '', last_name: names.last_name ?? words.slice(1).join(' '), email };
  const sectionValue = invoiceSection.toSubmit();
  const party = { company_name: sectionValue.buyer.company_name, nip: sectionValue.buyer.tax_id, address: sectionValue.buyer.address, city: sectionValue.buyer.city, postal_code: sectionValue.buyer.postal_code, country: sectionValue.buyer.country, tax_id_mode: invoiceSection.mode };
  const recipient = sectionValue.recipient;
  const participantConfig = profile?.modules.find(module => module.id === 'participants');
  const people = Array.from({ length: quantity }, (_, index) => ({
    ...(quantity === 1 && participantConfig?.prefill_from_buyer ? person : { first_name: '', last_name: '', email: '' }),
    ...participants[index],
  }));
  const values: Record<string, unknown> = {};
  for (const config of profile?.modules ?? []) {
    switch (config.id) {
      case 'buyer': values.buyer = buyerType === 'person' ? { type: buyerType, ...person } : { type: buyerType, ...party, email, ...(person.first_name ? { first_name: person.first_name } : {}), ...(person.last_name ? { last_name: person.last_name } : {}) }; break;
      case 'recipient': values.recipient = buyerType === 'organization' && recipient
        ? { differs: true, company_name: recipient.company_name, nip: recipient.tax_id, address: recipient.address, postal_code: recipient.postal_code, city: recipient.city }
        : { differs: false }; break;
      case 'phone': values.phone = phone; break;
      case 'quantity': values.quantity = quantity; break;
      case 'participants': values.participants = !(config.allow_later && later) && (config.required || includeParticipants) ? people : []; break;
    }
  }
  const validate = () => {
    if (!profile) return true;
    const result = validateModuleValues(profile, values, { locale: 'en', currency: '', quantity });
    setErrors(result.success ? [] : result.errors);
    return result.success;
  };
  return { validate, errors, setErrors, values, buyerType, setBuyerType, person, setNames, invoiceSection, phone, setPhone, people, setParticipants, includeParticipants, setIncludeParticipants, later, setLater };
}

type ModuleConfig = CheckoutProfile['modules'][number];
type ProfileFormState = ReturnType<typeof useCheckoutProfileValues>;
interface Props { profile: CheckoutProfile; state: ProfileFormState; errors: FieldError[]; disabled: boolean }
export default function CheckoutProfileFields({ profile, state, errors, disabled: processing }: Props) {
  const interactive = useProfileInteractive();
  const disabled = !interactive || processing;
  const t = useTranslations('checkout.profile');
  const fieldsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length && !disabled) {
      const first = fieldsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus({ preventScroll: true });
    }
  }, [errors, disabled]);
  const inputClass = 'w-full rounded-lg border border-sf-border bg-sf-input px-3 py-2.5 text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent';
  const errorText = (field: string) => {
    const error = errors.find(error => error.field === field);
    return error ? error.maximum ? t('errors.tooLong', { max: error.maximum }) : t(`errors.${t.has(`errors.${error.code}`) ? error.code : 'invalid'}`) : null;
  };
  const field = (id: string, label: string, value: string, onChange: (value: string) => void, type = 'text') => (
    <div key={id}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-sf-body">{label}</label>
      <input id={id} type={type} value={value} onChange={event => onChange(event.target.value)}
        disabled={disabled} className={errorText(id) ? inputClass.replace('border-sf-border', 'border-sf-danger') : inputClass} aria-invalid={!!errorText(id)} aria-describedby={errorText(id) ? `${id}-error` : undefined} />
      {errorText(id) && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-sf-danger">{errorText(id)}</p>}
    </div>
  );
  const personFields = (prefix: string, person: Person, update: (key: keyof Person, value: string) => void, includeEmail: boolean) =>
    (includeEmail ? ['first_name', 'last_name', 'email'] as const : ['first_name', 'last_name'] as const).map(key =>
      field(`${prefix}.${key}`, t(key), person[key], value => update(key, value), key === 'email' ? 'email' : 'text'));
  const forms: Record<Exclude<ModuleConfig['id'], 'quantity' | 'recipient'>, (config: ModuleConfig) => ReactNode> = {
    buyer: config => config.id === 'buyer' && <>
        <label className="block text-sm text-sf-body" htmlFor="buyer.type">{t('buyerType')}</label>
        <select id="buyer.type" value={state.buyerType} className={inputClass} onChange={event => state.setBuyerType(event.target.value as 'person' | 'organization')}>
          {config.types.map(type => <option key={type} value={type}>{t(type)}</option>)}
        </select>
        {personFields('buyer', state.person, (key, value) => state.setNames(previous => ({ ...previous, [key]: value })), false)}
        {/* The same invoice section as the standard checkout; the recipient (when the profile has it) sits inside it. */}
        {state.buyerType === 'organization' && <InvoiceSection section={state.invoiceSection} disabled={disabled} fixed />}
      </>,
    phone: () => field('phone', t('phone'), state.phone, state.setPhone, 'tel'),
    participants: config => config.id === 'participants' && <ParticipantsEditor people={state.people as Person[]} required={config.required} allowLater={!!config.allow_later} later={state.later} setLater={state.setLater}
        includeParticipants={state.includeParticipants} setIncludeParticipants={state.setIncludeParticipants} errorText={errorText} inputClass={inputClass}
        update={(index, key, value) => state.setParticipants(previous => ({ ...previous, [index]: { ...previous[index], [key]: value } }))}
        fill={rows => state.setParticipants(Object.fromEntries(rows.map((row, index) => [index, row])))} />,
  };
  return <div ref={fieldsRef} className="space-y-6">{profile.modules.map(config => {
    // The recipient is part of the organization's invoice section (rendered by the buyer module).
    if (config.id === 'quantity' || config.id === 'recipient') return null;
    if (config.id === 'phone') return <div key={config.id} className="rounded-xl border border-sf-border p-4">{forms.phone(config)}</div>;
    return <fieldset key={config.id} disabled={disabled} className="space-y-3 rounded-xl border border-sf-border p-4">
      <legend className="px-1 font-semibold text-sf-heading">{t(config.id)}</legend>
      {errorText(config.id) && <p role="alert" className="text-sm text-sf-danger">{errorText(config.id)}</p>}
      {forms[config.id](config)}
    </fieldset>;
  })}</div>;
}

/** Quantity stepper: big labelled buttons, typed value still allowed, range stated under the control. */
export function CheckoutQuantityField({ config, value, onChange, invalid }: { config: Extract<CheckoutProfile['modules'][number], { id: 'quantity' }>; value: string; onChange: (value: string) => void; invalid: boolean }) {
  const interactive = useProfileInteractive();
  const t = useTranslations('checkout.profile');
  const parsed = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const current = Number.isFinite(parsed) && parsed >= config.min && parsed <= config.max ? parsed : null;
  const step = (delta: number) => onChange(String(Math.min(config.max, Math.max(config.min, (current ?? (delta > 0 ? config.min - 1 : config.max + 1)) + delta))));
  const stepButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-sf-border bg-sf-input text-xl font-semibold leading-none text-sf-heading transition-colors hover:bg-sf-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent disabled:cursor-not-allowed disabled:opacity-40';
  return <div className="mb-4 rounded-2xl border border-sf-border bg-sf-raised p-4">
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor="checkoutQuantity" className="block text-base font-semibold text-sf-heading">{t('quantity')}</label>
        <p id="checkoutQuantity-range" className="text-sm text-sf-muted">{t('quantityRange', { min: config.min, max: config.max })}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={stepButton} aria-label={t('quantityDecrease')} aria-controls="checkoutQuantity" disabled={!interactive || (current !== null && current <= config.min)} onClick={() => step(-1)}>−</button>
        <input id="checkoutQuantity" className={`h-11 w-16 rounded-lg border ${invalid ? 'border-sf-danger' : 'border-sf-border'} bg-sf-input px-2 text-center text-lg font-semibold tabular-nums text-sf-heading focus:outline-none focus:ring-2 focus:ring-sf-accent`}
          type="text" inputMode="numeric" autoComplete="off" value={value} disabled={!interactive} aria-required="true" aria-invalid={invalid} aria-describedby={invalid ? 'checkoutQuantity-error checkoutQuantity-range' : 'checkoutQuantity-range'} onChange={event => onChange(event.target.value)} />
        <button type="button" className={stepButton} aria-label={t('quantityIncrease')} aria-controls="checkoutQuantity" disabled={!interactive || (current !== null && current >= config.max)} onClick={() => step(1)}>+</button>
      </div>
    </div>
    {invalid && <p id="checkoutQuantity-error" role="alert" className="mt-2 text-sm text-sf-danger">{t('errors.invalid')} ({config.min}–{config.max})</p>}
  </div>;
}
