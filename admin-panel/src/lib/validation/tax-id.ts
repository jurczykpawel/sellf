/**
 * Country-aware buyer tax identifier (owner decision 2026-11-03):
 *  - PL: NIP with checksum,
 *  - EU: VAT number with the country prefix and that country's format,
 *  - outside the EU: any identifier, no format check (only length and unsafe characters).
 * The country comes from the company address, never from the number itself.
 *
 * @see ./nip.ts (Polish checksum)
 * @see ../checkout-modules/buyer.ts
 */

import { EU_COUNTRY_CODES } from '@/lib/checkout/eu-countries';
import { normalizeNIP, validateNIPChecksum } from '@/lib/validation/nip';

export type TaxIdType = 'pl_nip' | 'eu_vat' | 'other';

export interface TaxIdClassification {
  type: TaxIdType;
  country: string;
  valid: boolean;
  /** PL: 10 digits; EU: prefix + number (Greece: EL); other: trimmed input. */
  normalized: string;
}

export const TAX_ID_MAX_LENGTH = 40;

/** Number part (after the prefix) of an EU VAT number, per the VIES formats. */
const EU_VAT_BODY: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/, DK: /^\d{8}$/, EE: /^\d{9}$/, EL: /^\d{9}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/, FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/, HR: /^\d{11}$/, HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/, IT: /^\d{11}$/, LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/, LV: /^\d{11}$/, MT: /^\d{8}$/, NL: /^\d{9}B\d{2}$/, PL: /^\d{10}$/, PT: /^\d{9}$/,
  RO: /^[1-9]\d{1,9}$/, SE: /^\d{10}01$/, SI: /^\d{8}$/, SK: /^\d{10}$/,
};

/** VAT prefix for an ISO country code (Greece uses EL). */
export function euVatPrefix(country: string): string {
  return country === 'GR' ? 'EL' : country;
}

export function taxIdTypeForCountry(country: string | null | undefined): TaxIdType {
  const code = (country ?? '').toUpperCase();
  if (code === 'PL') return 'pl_nip';
  return EU_COUNTRY_CODES.has(code) ? 'eu_vat' : 'other';
}

export function classifyTaxId(value: string, countryInput: string): TaxIdClassification {
  const country = countryInput.toUpperCase();
  const type = taxIdTypeForCountry(country);
  const raw = value ?? '';

  if (type === 'pl_nip') {
    const normalized = normalizeNIP(raw, true);
    return { type, country, normalized, valid: raw.length <= TAX_ID_MAX_LENGTH && validateNIPChecksum(normalized) };
  }

  if (type === 'eu_vat') {
    const prefix = euVatPrefix(country);
    const cleaned = raw.replace(/[-\s.]/g, '').toUpperCase();
    const body = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : /^[A-Z]{2}/.test(cleaned) && !EU_VAT_BODY[prefix].test(cleaned) ? null : cleaned;
    const normalized = body === null ? cleaned : `${prefix}${body}`;
    return { type, country, normalized, valid: raw.length <= TAX_ID_MAX_LENGTH && body !== null && EU_VAT_BODY[prefix].test(body) };
  }

  const normalized = raw.trim();
  // eslint-disable-next-line no-control-regex
  return { type, country, normalized, valid: normalized.length <= TAX_ID_MAX_LENGTH && !/[\u0000-\u001f\u007f<>]/.test(normalized) };
}

/** Type + country of a stored tax id, for orders, invoices, webhooks and the API. Null without a number. */
export function describeTaxId(nip: string | null | undefined, country: string | null | undefined): { type: TaxIdType; country: string | null } | null {
  if (!nip || !nip.trim()) return null;
  const code = country ? country.toUpperCase() : null;
  return { type: taxIdTypeForCountry(code), country: code };
}
