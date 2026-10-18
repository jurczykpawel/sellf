import { currencyExponent } from './minor-units';

export type MoneyInputError = 'fraction_not_allowed' | 'too_many_decimals' | 'invalid_format';

export type MoneyInputResult =
  | { value: number | null; error: null }
  | { value: null; error: MoneyInputError };

const DECIMAL_SEPARATOR_BY_LOCALE: Record<string, ',' | '.'> = { en: '.' };
const fail = (error: MoneyInputError): MoneyInputResult => ({ value: null, error });

function checkDecimals(fraction: string, currency: string): MoneyInputError | null {
  const exponent = currencyExponent(currency);
  if (exponent === 0) return /^0*$/.test(fraction) ? null : 'fraction_not_allowed';
  return fraction.length > exponent ? 'too_many_decimals' : null;
}

function isGrouped(integerPart: string, separator: string): boolean {
  const groups = integerPart.split(separator);
  return groups[0].length >= 1 && groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3);
}

/**
 * Parses what a seller typed into a money field without ever changing its magnitude:
 * the decimal separator is whichever separator ends the number, group separators are
 * validated, and fractions the currency cannot hold are reported instead of dropped.
 * A lone separator followed by exactly three digits is a thousands separator unless it
 * is the locale's decimal separator (or the whole currency has no minor unit).
 */
export function parseMoneyInput(raw: string, currency: string, locale: string): MoneyInputResult {
  const text = raw.replace(/[\s  ]/g, '');
  if (text === '') return { value: null, error: null };
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return fail('invalid_format');

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  const hasBoth = lastDot !== -1 && lastComma !== -1;
  const lastSeparator = Math.max(lastDot, lastComma);
  const separator = lastSeparator === -1 ? null : text[lastSeparator];

  let integerPart = text;
  let fraction = '';

  if (separator) {
    const occurrences = text.split(separator).length - 1;
    const tail = text.slice(lastSeparator + 1);
    const head = text.slice(0, lastSeparator);
    const localeDecimal = DECIMAL_SEPARATOR_BY_LOCALE[locale.split('-')[0]] ?? ',';
    const zeroDecimal = currencyExponent(currency) === 0;

    let asGroup: boolean;
    if (hasBoth) {
      asGroup = false;
    } else if (occurrences > 1) {
      asGroup = true;
    } else {
      asGroup = tail.length === 3 && head !== '0' && head !== '' && (zeroDecimal || separator !== localeDecimal);
    }

    if (asGroup) {
      if (!isGrouped(text, separator)) return fail('invalid_format');
      integerPart = text.replace(new RegExp(`\\${separator}`, 'g'), '');
    } else {
      if (occurrences > 1) return fail('invalid_format');
      const other = separator === '.' ? ',' : '.';
      if (head.includes(other) && !isGrouped(head, other)) return fail('invalid_format');
      integerPart = head.replace(new RegExp(`\\${other}`, 'g'), '');
      fraction = tail;
    }
  }

  const decimalsError = checkDecimals(fraction, currency);
  if (decimalsError) return fail(decimalsError);
  return { value: Number(`${integerPart || '0'}${fraction ? `.${fraction}` : ''}`), error: null };
}

/** Error for a numeric amount that cannot be charged in this currency, or null. */
export function moneyAmountError(amount: number | null | undefined, currency: string): MoneyInputError | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const exponent = currencyExponent(currency);
  if (Number.isInteger(amount)) return null;
  return exponent === 0 ? 'fraction_not_allowed' : Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6 ? 'too_many_decimals' : null;
}
