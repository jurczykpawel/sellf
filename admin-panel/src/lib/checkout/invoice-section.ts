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

export type TaxIdErrorCode = 'nip_length' | 'nip_checksum' | 'unknown_prefix' | 'eu_vat_format' | 'not_tax_id' | 'nip_only' | 'invalid_tax_id';
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
 */
export function detectTaxId(raw: string, { allowEu = true }: { allowEu?: boolean } = {}): TaxIdDetection {
  const cleaned = (raw ?? '').replace(/[\s.-]/g, '').toUpperCase();
  if (!cleaned) return { status: 'empty' };
  if (cleaned.length > TAX_ID_MAX_LENGTH || !/^[A-Z0-9]+$/.test(cleaned)) return { status: 'invalid', code: 'not_tax_id' };
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

function checkAddress(prefix: string, party: Record<keyof typeof ADDRESS_LIMITS, string>, errors: InvoiceFieldError[]): Record<keyof typeof ADDRESS_LIMITS, string> {
  const out = {} as Record<keyof typeof ADDRESS_LIMITS, string>;
  for (const [key, max] of Object.entries(ADDRESS_LIMITS) as [keyof typeof ADDRESS_LIMITS, number][]) {
    const value = (party[key] ?? '').trim();
    if (!value) errors.push({ field: `${prefix}.${key}`, code: 'required' });
    else if (value.length > max) errors.push({ field: `${prefix}.${key}`, code: 'too_long' });
    else if (/[\u0000-\u001f\u007f<>]/.test(value)) errors.push({ field: `${prefix}.${key}`, code: 'invalid_text' });
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

/** Validate the whole section. Without "I want a company invoice" nothing about a company is kept. */
export function validateInvoiceSection(input: InvoiceSectionInput, { recipientEnabled }: { recipientEnabled: boolean }): InvoiceSectionResult {
  const parsed = invoiceSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: [{ field: 'invoice', code: 'invalid_text' }] };
  const value = parsed.data;
  if (!value.want) return { ok: true, buyer: null, recipient: null };

  const errors: InvoiceFieldError[] = [];
  let buyerTax: Pick<InvoiceParty, 'nip' | 'tax_id_type' | 'tax_id_country'> = { nip: '' };
  let country = value.buyer.country.trim().toUpperCase();

  if (value.mode === 'tax_id') {
    const detected = detectTaxId(value.buyer.tax_id);
    if (detected.status === 'empty') errors.push({ field: 'invoice.tax_id', code: 'tax_id_required' });
    else if (detected.status === 'invalid') errors.push({ field: 'invoice.tax_id', code: detected.code });
    else { country = detected.country; buyerTax = taxFields(detected.normalized, detected.type, detected.country); }
  } else {
    if (!COUNTRY_CODES.has(country)) errors.push({ field: 'invoice.country', code: 'invalid_country' });
    const taxId = value.buyer.tax_id.trim();
    if (taxId && COUNTRY_CODES.has(country)) {
      const classified = classifyTaxId(taxId, country);
      if (classified.valid) buyerTax = taxFields(classified.normalized, classified.type, classified.country);
      else errors.push({ field: 'invoice.tax_id', code: manualTaxIdError(taxId, classified.type) });
    }
  }
  const buyerAddress = checkAddress('invoice', value.buyer, errors);

  let recipient: InvoiceParty | null = null;
  if (value.recipient) {
    if (!recipientEnabled) errors.push({ field: 'recipient', code: 'recipient_disabled' });
    else {
      const detected = detectTaxId(value.recipient.tax_id, { allowEu: false });
      let tax: Pick<InvoiceParty, 'nip' | 'tax_id_type' | 'tax_id_country'> = { nip: '' };
      if (detected.status === 'empty') errors.push({ field: 'recipient.tax_id', code: 'tax_id_required' });
      else if (detected.status === 'invalid') errors.push({ field: 'recipient.tax_id', code: detected.code });
      else tax = taxFields(detected.normalized, detected.type, detected.country);
      recipient = { ...checkAddress('recipient', value.recipient, errors), country: 'PL', ...tax };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, buyer: { ...buyerAddress, country, ...buyerTax }, recipient };
}
