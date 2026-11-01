/** Fixed-price subscription trial presentation. @see lib/stripe/subscription-checkout.ts */
import type { Product } from '@/types';

export function getTrialDays(product: Pick<Product, 'product_type' | 'trial_days' | 'allow_custom_price'>): number | null {
  return product.product_type === 'subscription' && !product.allow_custom_price && Number.isInteger(product.trial_days) && (product.trial_days ?? 0) > 0
    ? product.trial_days! : null;
}

/** Relative trial periods use elapsed days, including across daylight-saving changes. */
export function trialEndFromStart(startSeconds: number, days: number): number {
  return startSeconds + days * 86400;
}

export function formatTrialDate(endSeconds: number, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(new Date(endSeconds * 1000));
}

/** Existing Auth templates render a short human-readable amount/details line. */
export function trialMailAmount(amount: string, start: string | null, end: string | null, locale: string): string {
  if (!start || !end) return amount;
  const startMs = Date.parse(start), endMs = Date.parse(end);
  const days = Math.round((endMs - startMs) / 86400000);
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs) || days < 1) return amount;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(endMs));
  return locale === 'pl'
    ? `${amount} — ${days === 1 ? '1 dzień' : `${days} dni`} próby; pierwsza płatność ${date} (UTC)`
    : `${amount} — ${days}-day trial; first payment ${date} (UTC)`;
}
