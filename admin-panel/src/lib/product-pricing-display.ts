import type { Product } from '@/types';
import { formatPrice } from '@/lib/constants';

type BillingInterval = NonNullable<Product['billing_interval']>;

const PL_INTERVAL_LABELS: Record<BillingInterval, string> = {
  day: 'dzień',
  week: 'tydz.',
  month: 'mies.',
  year: 'rok',
};

const EN_INTERVAL_LABELS: Record<BillingInterval, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

function isPolishLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith('pl');
}

export function formatBillingIntervalLabel(
  interval: BillingInterval | null | undefined,
  count: number | null | undefined,
  locale: string
): string {
  if (!interval) return '';

  const intervalCount = Math.max(1, count ?? 1);
  if (isPolishLocale(locale)) {
    const label = PL_INTERVAL_LABELS[interval];
    return intervalCount === 1 ? label : `co ${intervalCount} ${label}`;
  }

  const label = EN_INTERVAL_LABELS[interval];
  return intervalCount === 1 ? label : `every ${intervalCount} ${label}s`;
}

export function formatRecurringProductPrice(
  product: Pick<Product, 'product_type' | 'recurring_price' | 'currency' | 'billing_interval' | 'billing_interval_count'>,
  locale: string,
  options: { includeCurrencyCode?: boolean } = {}
): string | null {
  if (product.product_type !== 'subscription') return null;
  if (!product.recurring_price || !product.billing_interval) return null;

  const amount = formatPrice(product.recurring_price, product.currency);
  const currencyCode = options.includeCurrencyCode ? ` ${product.currency}` : '';
  // formatPrice already includes the currency symbol (e.g. "zł20.00"); the optional
  // ISO code is for admin/dashboard contexts where multiple currencies coexist and
  // disambiguation matters. Checkout/storefront flows should leave this off.
  const interval = formatBillingIntervalLabel(
    product.billing_interval,
    product.billing_interval_count,
    locale
  );

  return `${amount}${currencyCode} / ${interval}`;
}
