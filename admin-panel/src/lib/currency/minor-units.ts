/**
 * Single source of truth for converting between display ("major") amounts and
 * Stripe minor units. Stripe treats the zero-decimal currencies below as having no
 * minor unit (500 JPY = `amount: 500`), every other currency Sellf accepts as
 * two-decimal. UGX/ISK are two-decimal on the Stripe API (always `00`), so they are
 * deliberately NOT listed here.
 * @see https://docs.stripe.com/currencies#zero-decimal
 *
 * Currencies a seller can pick today (SUPPORTED_CURRENCY_CODES) that are zero-decimal:
 * JPY, KRW, VND. The SQL twin is `public.currency_minor_factor`.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** Stripe minimum charge for currencies where it is not the generic 0.50 (docs.stripe.com/currencies). */
const MINIMUM_CHARGE: Readonly<Record<string, number>> = { JPY: 50, KRW: 50 };
const DEFAULT_MINIMUM_CHARGE = 0.5;

export function currencyExponent(currency: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function minorFactor(currency: string): 1 | 100 {
  return currencyExponent(currency) === 0 ? 1 : 100;
}

/** Display amount (e.g. 49.99 PLN, 1000 JPY) to Stripe minor units (4999, 1000). */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * minorFactor(currency));
}

/** Stripe minor units to display amount. */
export function fromMinorUnits(minor: number, currency: string): number {
  return minor / minorFactor(currency);
}

/** Smallest amount Stripe accepts for a charge in this currency, in display units. */
export function minimumChargeAmount(currency: string): number {
  return MINIMUM_CHARGE[currency.toUpperCase()] ?? DEFAULT_MINIMUM_CHARGE;
}

/** True for a paid total (minor units) that Stripe would refuse; 0 (free) is never "below". */
export function isBelowMinimumCharge(minor: number, currency: string): boolean {
  return minor > 0 && minor < toMinorUnits(minimumChargeAmount(currency), currency);
}
