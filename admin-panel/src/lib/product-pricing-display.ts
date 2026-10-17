import { formatPrice } from '@/lib/constants';
import type { Product } from '@/types';

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

  const amount = formatPrice(product.recurring_price, product.currency, locale);
  const currencyCode = options.includeCurrencyCode ? ` ${product.currency}` : '';
  // formatPrice already includes the currency symbol (e.g. "20,00 zł"); the optional
  // ISO code is for admin/dashboard contexts where multiple currencies coexist and
  // disambiguation matters. Checkout/storefront flows should leave this off.
  const interval = formatBillingIntervalLabel(
    product.billing_interval,
    product.billing_interval_count,
    locale
  );

  return `${amount}${currencyCode} / ${interval}`;
}

export type VatDisplay =
  | { kind: 'none' }
  | { kind: 'rate'; rate: number }
  /** Net price: VAT is added on top at checkout ("+ VAT x%"). */
  | { kind: 'rate_added'; rate: number }
  | { kind: 'exempt'; note: string | null };

/**
 * What the storefront shows next to a price. Mirrors the charge path
 * (checkout-line-items): in local tax mode an exempt product carries no tax even though
 * its vat_rate column still holds a rate, so it is labelled exempt instead of "+ VAT x%".
 * In Stripe Tax mode Stripe is the sole authority on taxability — nothing is shown.
 */
export function getVatDisplay(input: {
  taxMode?: 'local' | 'stripe_tax';
  vatRate: number | null | undefined;
  vatExempt: boolean | null | undefined;
  vatExemptNote?: string | null;
  /** Amount shown next to the label; a free product (0) carries no VAT label. */
  amount?: number | null;
  /** Pay-what-you-want / tip jar: the buyer chooses the amount, so a 0 list price is not "free". */
  allowCustomPrice?: boolean | null;
  /** false = net price, VAT is added at checkout. Omitted/true = VAT is inside the price. */
  priceIncludesVat?: boolean | null;
}): VatDisplay {
  if (input.taxMode === 'stripe_tax') return { kind: 'none' };
  if (input.amount != null && input.amount <= 0 && !input.allowCustomPrice) return { kind: 'none' };
  if (input.vatExempt) return { kind: 'exempt', note: input.vatExemptNote?.trim() || null };
  if (input.vatRate != null && input.vatRate > 0) {
    return input.priceIncludesVat === false
      ? { kind: 'rate_added', rate: input.vatRate }
      : { kind: 'rate', rate: input.vatRate };
  }
  return { kind: 'none' };
}
