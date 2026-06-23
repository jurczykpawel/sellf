/**
 * Single source of truth for EU member states used across checkout:
 *  - the buyer-country selector (InvoiceFields) — needs code + display name,
 *  - the eu_vat gate (buyer-tax-identity) — needs the set of codes.
 *
 * Stable reference data (EU membership changes ~once a decade). Note: Greece's VAT-number
 * prefix is EL, not its ISO code GR — that one exception lives in buyer-tax-identity.toEuVatValue,
 * not here (this list is ISO-3166 codes).
 */
export const EU_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'PL', name: 'Polska' },
  { code: 'AT', name: 'Austria' }, { code: 'BE', name: 'Belgia' }, { code: 'BG', name: 'Bułgaria' },
  { code: 'HR', name: 'Chorwacja' }, { code: 'CY', name: 'Cypr' }, { code: 'CZ', name: 'Czechy' },
  { code: 'DK', name: 'Dania' }, { code: 'EE', name: 'Estonia' }, { code: 'FI', name: 'Finlandia' },
  { code: 'FR', name: 'Francja' }, { code: 'GR', name: 'Grecja' }, { code: 'ES', name: 'Hiszpania' },
  { code: 'NL', name: 'Holandia' }, { code: 'IE', name: 'Irlandia' }, { code: 'LT', name: 'Litwa' },
  { code: 'LU', name: 'Luksemburg' }, { code: 'LV', name: 'Łotwa' }, { code: 'MT', name: 'Malta' },
  { code: 'DE', name: 'Niemcy' }, { code: 'PT', name: 'Portugalia' }, { code: 'RO', name: 'Rumunia' },
  { code: 'SK', name: 'Słowacja' }, { code: 'SI', name: 'Słowenia' }, { code: 'SE', name: 'Szwecja' },
  { code: 'HU', name: 'Węgry' }, { code: 'IT', name: 'Włochy' },
] as const;

/** Set of EU ISO-3166 codes — for the eu_vat reverse-charge gate. */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set(EU_COUNTRIES.map((c) => c.code));
