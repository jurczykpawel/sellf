/**
 * Checkout invoice section (accepted mockup v3, owner 10.11): "I want a company invoice" →
 * one field "NIP or EU VAT number" (the number decides the company country) → company data
 * in separate address fields; "No NIP or the company is outside the EU" → the same address block
 * with a country choice. A different invoice recipient (institutions only) is a shop setting and
 * always carries a Polish NIP. Pure: the browser and /api/update-payment-metadata run the same
 * rules, so the messages match on both sides.
 *
 * @see ./invoice-company-lookup.ts (where company data comes from: GUS now, VIES later)
 * @see ../validation/tax-id.ts (country formats)
 * @see src/components/checkout/InvoiceSection.tsx
 */

import { z } from 'zod';
import { EU_COUNTRY_CODES } from '@/lib/checkout/eu-countries';
import countryOptions from '@/lib/checkout/country-options.json';
import { classifyTaxId, TAX_ID_MAX_LENGTH } from '@/lib/validation/tax-id';
import { validateNIPChecksum } from '@/lib/validation/nip';
import type { TaxIdType } from '@/lib/validation/tax-id';

export type TaxIdErrorCode = 'nip_length' | 'nip_checksum' | 'unknown_prefix' | 'eu_vat_format' | 'not_tax_id' | 'nip_only' | 'invalid_tax_id' | 'tax_id_too_long';
export type InvoiceFieldErrorCode = TaxIdErrorCode | 'required' | 'tax_id_required' | 'too_long' | 'invalid_text' | 'invalid_country' | 'recipient_disabled';

export type TaxIdDetection =
  | { status: 'empty' }
  | { status: 'valid'; type: Extract<TaxIdType, 'pl_nip' | 'eu_vat'>; country: string; normalized: string }
  | { status: 'invalid'; code: TaxIdErrorCode };

/** ISO country for an EU VAT prefix (Greece writes EL). Null for prefixes outside the EU and for PL. */
function euCountryForPrefix(prefix: string): string | null {
  if (prefix === 'GR' || prefix === 'PL') return null;
  const iso = prefix === 'EL' ? 'GR' : prefix;
  return EU_COUNTRY_CODES.has(iso) ? iso : null;
}

/**
 * Read the single tax id field. A two-letter prefix other than PL means an EU VAT number of that
 * country; digits (with or without PL) mean a Polish NIP. The recipient field takes only a NIP.
 * One length limit (TAX_ID_MAX_LENGTH) for the form, this check and the stored value; which
 * characters a VAT number may hold (Irish numbers carry + or *) is left to the country pattern.
 */
export function detectTaxId(raw: string, { allowEu = true }: { allowEu?: boolean } = {}): TaxIdDetection {
  const cleaned = (raw ?? '').replace(/[\s.-]/g, '').toUpperCase();
  if (!cleaned) return { status: 'empty' };
  if ((raw ?? '').trim().length > TAX_ID_MAX_LENGTH) return { status: 'invalid', code: 'tax_id_too_long' };
  if (!/^[A-Z0-9+*]+$/.test(cleaned)) return { status: 'invalid', code: 'not_tax_id' };
  const prefix = /^[A-Z]{2}/.test(cleaned) ? cleaned.slice(0, 2) : null;
  if (prefix && prefix !== 'PL') {
    if (!allowEu) return { status: 'invalid', code: 'nip_only' };
    const country = euCountryForPrefix(prefix);
    if (!country) return { status: 'invalid', code: 'unknown_prefix' };
    const classified = classifyTaxId(cleaned, country);
    return classified.valid
      ? { status: 'valid', type: 'eu_vat', country, normalized: classified.normalized }
      : { status: 'invalid', code: 'eu_vat_format' };
  }
  const digits = prefix === 'PL' ? cleaned.slice(2) : cleaned;
  if (!/^\d+$/.test(digits)) return { status: 'invalid', code: 'not_tax_id' };
  if (digits.length !== 10) return { status: 'invalid', code: 'nip_length' };
  if (!validateNIPChecksum(digits)) return { status: 'invalid', code: 'nip_checksum' };
  return { status: 'valid', type: 'pl_nip', country: 'PL', normalized: digits };
}

// ===== Submitted value (the browser sends exactly this; the server re-validates it) =====

const text = z.string().max(400).default('');
const partyInput = { tax_id: text, company_name: text, address: text, postal_code: text, city: text };
export const invoiceSectionSchema = z.object({
  want: z.boolean(),
  mode: z.enum(['tax_id', 'manual']),
  buyer: z.object({ ...partyInput, country: z.string().max(10).default('PL') }).strict(),
  recipient: z.object(partyInput).strict().nullish(),
}).strict();
export type InvoiceSectionInput = z.input<typeof invoiceSectionSchema>;

/** Stored invoice party, in the order_details buyer/recipient format. */
export interface InvoiceParty {
  company_name: string;
  nip: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  tax_id_type?: TaxIdType;
  tax_id_country?: string;
}

export interface InvoiceFieldError { field: string; code: InvoiceFieldErrorCode }
export type InvoiceSectionResult =
  | { ok: true; buyer: InvoiceParty | null; recipient: InvoiceParty | null }
  | { ok: false; errors: InvoiceFieldError[] };

const ADDRESS_LIMITS = { company_name: 200, address: 300, postal_code: 20, city: 100 } as const;
const COUNTRY_CODES: ReadonlySet<string> = new Set(countryOptions.en.map(c => c.code));

type AddressKey = keyof typeof ADDRESS_LIMITS;
export type InvoicePartyKey = AddressKey | 'tax_id' | 'country';
/** A field error of one party, named without its prefix (the caller places it on its own field). */
export interface InvoicePartyError { key: InvoicePartyKey; code: InvoiceFieldErrorCode }
export interface InvoicePartyInput { tax_id: string; company_name: string; address: string; postal_code: string; city: string }
export interface InvoicePartyResult { party: InvoiceParty; errors: InvoicePartyError[] }

function checkAddress(party: Record<AddressKey, string>, errors: InvoicePartyError[]): Record<AddressKey, string> {
  const out = {} as Record<AddressKey, string>;
  for (const [key, max] of Object.entries(ADDRESS_LIMITS) as [AddressKey, number][]) {
    const value = (party[key] ?? '').trim();
    if (!value) errors.push({ key, code: 'required' });
    else if (value.length > max) errors.push({ key, code: 'too_long' });
    else if (/[\u0000-\u001f\u007f<>]/.test(value)) errors.push({ key, code: 'invalid_text' });
    out[key] = value;
  }
  return out;
}

function taxFields(nip: string, type: TaxIdType, country: string): Pick<InvoiceParty, 'nip' | 'tax_id_type' | 'tax_id_country'> {
  return { nip, tax_id_type: type, tax_id_country: country };
}

function manualTaxIdError(taxId: string, type: TaxIdType): TaxIdErrorCode {
  if (type === 'eu_vat') return 'eu_vat_format';
  if (type === 'other') return 'invalid_tax_id';
  const detected = detectTaxId(taxId, { allowEu: false });
  return detected.status === 'invalid' ? detected.code : 'nip_checksum';
}

/**
 * The invoice buyer (company). NIP path: the number is required and decides the country. Manual
 * path: a chosen country, an optional number checked by that country's pattern. Shared by the
 * standard checkout section and the checkout profile buyer module.
 */
export function validateInvoiceBuyer(input: InvoicePartyInput & { country: string }, mode: 'tax_id' | 'manual'): InvoicePartyResult {
  const errors: InvoicePartyError[] = [];
  let tax: Pick<InvoiceParty, 'nip' | 'tax_id_type' | 'tax_id_country'> = { nip: '' };
  let country = (input.country ?? '').trim().toUpperCase();
  if (mode === 'tax_id') {
    const detected = detectTaxId(input.tax_id);
    if (detected.status === 'empty') errors.push({ key: 'tax_id', code: 'tax_id_required' });
    else if (detected.status === 'invalid') errors.push({ key: 'tax_id', code: detected.code });
    else { country = detected.country; tax = taxFields(detected.normalized, detected.type, detected.country); }
  } else {
    if (!COUNTRY_CODES.has(country)) errors.push({ key: 'country', code: 'invalid_country' });
    const taxId = (input.tax_id ?? '').trim();
    if (taxId.length > TAX_ID_MAX_LENGTH) errors.push({ key: 'tax_id', code: 'tax_id_too_long' });
    else if (taxId && COUNTRY_CODES.has(country)) {
      const classified = classifyTaxId(taxId, country);
      if (classified.valid) tax = taxFields(classified.normalized, classified.type, classified.country);
      else errors.push({ key: 'tax_id', code: manualTaxIdError(taxId, classified.type) });
    }
  }
  const address = checkAddress(input, errors);
  return { party: { ...address, country, ...tax }, errors };
}

/** A different invoice recipient: an institution in Poland, always with a Polish NIP. */
export function validateInvoiceRecipient(input: InvoicePartyInput): InvoicePartyResult {
  const errors: InvoicePartyError[] = [];
  let tax: Pick<InvoiceParty, 'nip' | 'tax_id_type' | 'tax_id_country'> = { nip: '' };
  const detected = detectTaxId(input.tax_id, { allowEu: false });
  if (detected.status === 'empty') errors.push({ key: 'tax_id', code: 'tax_id_required' });
  else if (detected.status === 'invalid') errors.push({ key: 'tax_id', code: detected.code });
  else tax = taxFields(detected.normalized, detected.type, detected.country);
  return { party: { ...checkAddress(input, errors), country: 'PL', ...tax }, errors };
}

const prefixed = (prefix: string, errors: InvoicePartyError[]): InvoiceFieldError[] =>
  errors.map(e => ({ field: `${prefix}.${e.key}`, code: e.code }));

/** Validate the whole section. Without "I want a company invoice" nothing about a company is kept. */
export function validateInvoiceSection(input: InvoiceSectionInput, { recipientEnabled }: { recipientEnabled: boolean }): InvoiceSectionResult {
  const parsed = invoiceSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: [{ field: 'invoice', code: 'invalid_text' }] };
  const value = parsed.data;
  if (!value.want) return { ok: true, buyer: null, recipient: null };

  const buyer = validateInvoiceBuyer(value.buyer, value.mode);
  const errors = prefixed('invoice', buyer.errors);
  let recipient: InvoiceParty | null = null;
  if (value.recipient) {
    if (!recipientEnabled) errors.push({ field: 'recipient', code: 'recipient_disabled' });
    else {
      const checked = validateInvoiceRecipient(value.recipient);
      errors.push(...prefixed('recipient', checked.errors));
      recipient = checked.party;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, buyer: buyer.party, recipient };
}

/**
 * The older flat request fields (needsInvoice, nip, companyName, …) as an invoice section, so a
 * standard checkout request without `invoice` meets exactly the same rules (W223ar #2). Flat data
 * always named the company country, so it maps to the manual path: chosen country, number checked
 * by that country's pattern, the whole address required.
 */
export function invoiceSectionFromFlatFields(flat: {
  needsInvoice?: unknown; nip?: unknown; companyName?: unknown; address?: unknown; city?: unknown; postalCode?: unknown; country?: unknown;
}): InvoiceSectionInput {
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  const taxId = str(flat.nip).trim();
  return {
    want: flat.needsInvoice === true || taxId !== '',
    mode: 'manual',
    buyer: {
      tax_id: taxId,
      company_name: str(flat.companyName),
      address: str(flat.address),
      postal_code: str(flat.postalCode),
      city: str(flat.city),
      country: str(flat.country).trim().toUpperCase() || 'PL',
    },
    recipient: null,
  };
}
