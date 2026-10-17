/** Presentation conversion only; persisted thresholds remain integer strings. @see model.ts */
import { minorSchema } from '@/lib/affiliates/model';
const digits = (currency: string): number => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
export function displayThreshold(minor: string, currency: string): string {
  const places = digits(currency), value = minor.padStart(places + 1, '0');
  return places ? `${value.slice(0, -places)}.${value.slice(-places)}` : value;
}
export function parseThreshold(amount: string, currency: string): string | null {
  const places = digits(currency), match = /^(0|[1-9]\d*)(?:[.,](\d+))?$/.exec(amount);
  if (!match || (match[2]?.length ?? 0) > places) return null;
  const value = BigInt(match[1] + (match[2] ?? '').padEnd(places, '0')).toString();
  return minorSchema.safeParse(value).success ? value : null;
}
