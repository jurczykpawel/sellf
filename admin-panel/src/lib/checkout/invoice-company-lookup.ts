/**
 * Where checkout company data comes from (owner 10.11: one mechanism in every checkout, GUS now,
 * VIES later). Each source maps its answer to the same separate address fields, so the invoice
 * section never knows which register answered.
 *
 * @see ./invoice-section.ts
 * @see ../gus/lookup.ts
 */

import { lookupCompanyByNip } from '@/lib/gus/lookup';
import type { TaxIdType } from '@/lib/validation/tax-id';

export interface LookedUpCompany {
  company_name: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
}

export type InvoiceCompanyLookup =
  | { ok: true; source: 'gus'; party: LookedUpCompany }
  | { ok: false; code: 'not_found' | 'not_configured' | 'rate_limit' | 'unavailable' | 'unsupported' };

/** Whether any source can answer for this kind of number (VIES for EU VAT numbers comes later). */
export function canLookUpCompany(type: TaxIdType): boolean {
  return type === 'pl_nip';
}

export async function lookupInvoiceCompany(
  taxId: { type: TaxIdType; normalized: string },
  signal?: AbortSignal,
): Promise<InvoiceCompanyLookup> {
  if (!canLookUpCompany(taxId.type)) return { ok: false, code: 'unsupported' };
  const result = await lookupCompanyByNip(taxId.normalized, signal);
  if (!result.ok) {
    return { ok: false, code: result.code === 'not_found' || result.code === 'not_configured' || result.code === 'rate_limit' ? result.code : 'unavailable' };
  }
  const d = result.data;
  const street = `${d.ulica ?? ''} ${d.nrNieruchomosci ?? ''}`.trim();
  return {
    ok: true,
    source: 'gus',
    party: {
      company_name: d.nazwa ?? '',
      address: d.nrLokalu ? `${street}/${d.nrLokalu}` : street,
      postal_code: d.kodPocztowy ?? '',
      city: d.miejscowosc ?? '',
      country: 'PL',
    },
  };
}
