'use client';

/**
 * Checkout invoice section (accepted mockup v3, owner 10.11 — priv/plans/2026-11-11-koszyk-nip-makieta.html):
 * "I want a company invoice" → one field "NIP or EU VAT number" → company card from GUS, or the
 * same address block (country, name, street and number, postal code, city; the country is locked
 * when it follows from the number). "No NIP or the company is outside the EU" opens the block with
 * a country choice. A different recipient appears only when the shop collects it.
 *
 * @see src/hooks/useInvoiceSection.ts
 */

import { useLocale, useTranslations } from 'next-intl';
import { getCountryOptions } from '@/lib/checkout/countries';
import { TAX_ID_MAX_LENGTH } from '@/lib/validation/tax-id';
import type { InvoicePartyFields, InvoiceRole, InvoiceSectionState } from '@/hooks/useInvoiceSection';

interface InvoiceSectionProps {
  section: InvoiceSectionState;
  disabled?: boolean;
  /** Stripe Tax needs the buyer's country even without a company invoice. */
  personCountry?: { value: string; onChange(value: string): void } | null;
  /** Checkout profile: the buyer type "organization" already asked for the invoice, so no checkbox. */
  fixed?: boolean;
}

const INPUT = 'w-full px-3 py-2.5 bg-sf-input border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed';
const LABEL = 'block text-sm font-medium text-sf-body mb-2';
const LINK = 'justify-self-start text-left text-sm text-sf-accent hover:text-sf-accent-hover underline underline-offset-2 min-h-8';

const IDS: Record<InvoiceRole, Record<keyof InvoicePartyFields, string>> = {
  buyer: { taxId: 'nip', companyName: 'companyName', address: 'address', postalCode: 'postalCode', city: 'city', country: 'country' },
  recipient: { taxId: 'recipientNip', companyName: 'recipientCompanyName', address: 'recipientAddress', postalCode: 'recipientPostalCode', city: 'recipientCity', country: 'recipientCountry' },
};
const ERROR_FIELDS: Record<keyof InvoicePartyFields, string> = {
  taxId: 'tax_id', companyName: 'company_name', address: 'address', postalCode: 'postal_code', city: 'city', country: 'country',
};
const AUTOCOMPLETE: Partial<Record<keyof InvoicePartyFields, string>> = {
  companyName: 'organization', address: 'address-line1', postalCode: 'postal-code', city: 'address-level2',
};

function FieldError({ id, code }: { id: string; code?: string }) {
  const t = useTranslations('checkout.invoiceSection.errors');
  if (!code) return null;
  return <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-sf-danger">{t.has(code) ? t(code) : t('required')}</p>;
}

function errorFor(section: InvoiceSectionState, role: InvoiceRole, key: keyof InvoicePartyFields): string | undefined {
  return section.errors[`${role === 'buyer' ? 'invoice' : 'recipient'}.${ERROR_FIELDS[key]}`];
}

function AddressBlock({ section, role, disabled }: { section: InvoiceSectionState; role: InvoiceRole; disabled?: boolean }) {
  const t = useTranslations('checkout.invoiceSection');
  const locale = useLocale();
  const party = role === 'buyer' ? section.buyer : section.recipient;
  const { countryLocked } = section.view(role);
  const ids = IDS[role];
  const countries = getCountryOptions(locale, party.fields.country);
  const countryName = countries.find(c => c.code === party.fields.country)?.name ?? party.fields.country;
  const text = (key: Exclude<keyof InvoicePartyFields, 'taxId' | 'country'>, label: string) => {
    const code = errorFor(section, role, key);
    return (
      <div className="min-w-0">
        <label htmlFor={ids[key]} className={LABEL}>{label}</label>
        <input
          type="text"
          id={ids[key]}
          value={party.fields[key]}
          onChange={e => section.setField(role, key, e.target.value)}
          autoComplete={AUTOCOMPLETE[key]}
          disabled={disabled}
          aria-invalid={!!code}
          aria-describedby={code ? `${ids[key]}-error` : undefined}
          className={`${INPUT} ${code ? 'border-sf-danger/50' : 'border-sf-border'}`}
        />
        <FieldError id={ids[key]} code={code} />
      </div>
    );
  };
  const manualTax = role === 'buyer' && section.mode === 'manual' && party.fields.country !== 'PL';
  const taxCode = errorFor(section, role, 'taxId');
  const countryCode = errorFor(section, role, 'country');

  return (
    <div className="grid gap-3" data-testid={`${role}-address`}>
      <div>
        <label htmlFor={ids.country} className={LABEL}>{t('country')}</label>
        {countryLocked ? (
          <>
            <input type="text" id={ids.country} value={countryName} readOnly aria-describedby={`${ids.country}-locked`} className={`${INPUT} border-sf-border bg-sf-raised cursor-default`} />
            <p id={`${ids.country}-locked`} className="mt-1 text-xs text-sf-muted">{t('countryLocked')}</p>
          </>
        ) : (
          <select
            id={ids.country}
            value={party.fields.country}
            onChange={e => section.setField(role, 'country', e.target.value)}
            disabled={disabled}
            aria-invalid={!!countryCode}
            className={`${INPUT} ${countryCode ? 'border-sf-danger/50' : 'border-sf-border'}`}
          >
            {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        )}
        <FieldError id={ids.country} code={countryCode} />
      </div>
      {text('companyName', t('companyName'))}
      {text('address', t('address'))}
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        {text('postalCode', t('postalCode'))}
        {text('city', t('city'))}
      </div>
      {manualTax && (
        <div>
          <label htmlFor="taxIdManual" className={LABEL}>{t('taxIdOptional')} <span className="text-sf-muted font-normal">{t('optional')}</span></label>
          <input
            type="text"
            id="taxIdManual"
            value={party.fields.taxId}
            maxLength={TAX_ID_MAX_LENGTH}
            onChange={e => section.setField('buyer', 'taxId', e.target.value)}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={!!taxCode}
            aria-describedby={taxCode ? 'taxIdManual-error' : undefined}
            className={`${INPUT} ${taxCode ? 'border-sf-danger/50' : 'border-sf-border'}`}
          />
          <FieldError id="taxIdManual" code={taxCode} />
        </div>
      )}
    </div>
  );
}

function TaxIdLookup({ section, role, disabled }: { section: InvoiceSectionState; role: InvoiceRole; disabled?: boolean }) {
  const t = useTranslations('checkout.invoiceSection');
  const party = role === 'buyer' ? section.buyer : section.recipient;
  const view = section.view(role);
  const id = IDS[role].taxId;
  const code = errorFor(section, role, 'taxId');
  const notice = party.lookup === 'unsupported' ? t('euNotice')
    : party.lookup === 'not_found' ? t('notFound')
      : party.lookup === 'rate_limit' ? t('rateLimit')
        : party.lookup === 'unavailable' ? t('unavailable') : null;

  return (
    <div className="grid gap-3">
      <div>
        <label htmlFor={id} className={LABEL}>{role === 'buyer' ? t('taxIdLabel') : t('recipientTaxId')}</label>
        <input
          type="text"
          id={id}
          value={party.fields.taxId}
          onChange={e => section.setTaxId(role, e.target.value)}
          onBlur={() => section.blurTaxId(role)}
          placeholder={role === 'buyer' ? t('taxIdPlaceholder') : t('recipientPlaceholder')}
          inputMode={role === 'buyer' ? 'text' : 'numeric'}
          autoComplete="off"
          maxLength={TAX_ID_MAX_LENGTH}
          disabled={disabled}
          aria-invalid={!!code}
          aria-describedby={code ? `${id}-error` : undefined}
          className={`${INPUT} ${code ? 'border-sf-danger/50' : party.lookup === 'found' ? 'border-sf-success/50' : 'border-sf-border'}`}
        />
        <FieldError id={id} code={code} />
      </div>
      {party.lookup === 'loading' && (
        <div role="status" className="flex items-center gap-2 text-sm text-sf-muted min-h-11">
          <span className="h-4 w-4 rounded-full border-2 border-sf-border border-t-sf-accent animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t('loading')}
        </div>
      )}
      {view.card && (
        <div data-testid={`${role}-company-card`} className="flex gap-3 items-start bg-sf-raised border border-sf-border rounded-lg p-3">
          <span className="grid place-items-center h-6 w-6 shrink-0 rounded-full bg-sf-success-soft text-sf-success text-xs font-bold" aria-hidden="true">✓</span>
          <div className="min-w-0">
            <b className="block text-sf-heading">{party.fields.companyName}</b>
            <span className="text-sm text-sf-muted">{party.fields.address}, {party.fields.postalCode} {party.fields.city}</span>
            <div><button type="button" className={LINK} onClick={() => section.startEditing(role)} disabled={disabled}>{t('editData')}</button></div>
          </div>
        </div>
      )}
      {view.address && notice && <p className="text-sm text-sf-warning" role="status">{notice}</p>}
      {view.address && <AddressBlock section={section} role={role} disabled={disabled} />}
    </div>
  );
}

export default function InvoiceSection({ section, disabled, personCountry, fixed = false }: InvoiceSectionProps) {
  const t = useTranslations('checkout.invoiceSection');
  const locale = useLocale();

  return (
    <div className="grid gap-3" data-testid="invoice-section">
      {personCountry && !section.want && (
        <div>
          <label htmlFor="personCountry" className={LABEL}>{t('personCountry')}</label>
          <select id="personCountry" value={personCountry.value} onChange={e => personCountry.onChange(e.target.value)} disabled={disabled} className={`${INPUT} border-sf-border`}>
            {getCountryOptions(locale, personCountry.value).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
      )}
      {!fixed && (
        <label className="flex items-center gap-3 min-h-11 cursor-pointer font-medium text-sf-body">
          <input type="checkbox" id="wantInvoice" checked={section.want} onChange={e => section.setWant(e.target.checked)} disabled={disabled} className="h-5 w-5 accent-sf-accent" />
          {t('wantInvoice')}
        </label>
      )}

      {section.want && (
        <div className="grid gap-4 rounded-xl bg-sf-input/60 border border-sf-border p-4">
          {section.mode === 'tax_id' ? (
            <div className="grid gap-3">
              <TaxIdLookup section={section} role="buyer" disabled={disabled} />
              <button type="button" className={LINK} onClick={() => section.setMode('manual')} disabled={disabled}>{t('toManual')}</button>
            </div>
          ) : (
            <div className="grid gap-3">
              <AddressBlock section={section} role="buyer" disabled={disabled} />
              <button type="button" className={LINK} onClick={() => section.setMode('tax_id')} disabled={disabled}>{t('toTaxId')}</button>
            </div>
          )}

          {section.recipientEnabled && (
            <div className="grid gap-3 border-t border-sf-border pt-4">
              <label className="flex items-center gap-3 min-h-11 cursor-pointer font-medium text-sf-body">
                <input type="checkbox" id="wantRecipient" checked={section.wantRecipient} onChange={e => section.setWantRecipient(e.target.checked)} disabled={disabled} className="h-5 w-5 accent-sf-accent" />
                {t('wantRecipient')}
              </label>
              {section.wantRecipient && (
                <div className="grid gap-2">
                  <TaxIdLookup section={section} role="recipient" disabled={disabled} />
                  <p className="text-xs text-sf-muted">{t('recipientHelp')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
