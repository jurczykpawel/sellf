/** Exact conversion for ordinary currency inputs. @see ../csv/formatter.ts */
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { signedMinorSchema } from '@/lib/affiliates/model';
import { currencyExponent } from '@/lib/currency/minor-units';
export function parsePayoutAmount(value: string, currency: string): string | null {
  if (!SUPPORTED_CURRENCY_CODES.some(code => code === currency)) return null;
  const decimals = currencyExponent(currency);
  const match = value.trim().replace(',', '.').match(/^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > decimals) return null;
  const amount = BigInt(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(decimals, '0')}`).toString();
  return signedMinorSchema.safeParse(amount).success ? amount : null;
}

export function displayPayoutAmount(minor: string, currency: string): string {
  const negative = minor.startsWith('-'), digits = minor.replace(/^-/, '').padStart(3, '0');
  const value = currencyExponent(currency) === 0 ? minor.replace(/^-/, '') : `${digits.slice(0, -2)}.${digits.slice(-2)}`;
  return `${negative ? '-' : ''}${value}`;
}
