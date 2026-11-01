/** Buyer-facing trial terms are separate from the recurring price. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ProductShowcase from '@/app/[locale]/checkout/[slug]/components/ProductShowcase';
import OrderSummary from '@/components/checkout/OrderSummary';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
import type { Product } from '@/types';
import type { ReactNode } from 'react';

function render(child: ReactNode, locale: 'pl' | 'en'): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, child));
}
const product = { id: 'trial-product', name: 'Trial course', slug: 'trial-course', price: 0, recurring_price: 11, product_type: 'subscription', billing_interval: 'month', billing_interval_count: 1, trial_days: 7, currency: 'PLN', vat_exempt: true } as Product;
describe('trial purchase presentation', () => {
  it.each(['pl', 'en'] as const)('shows zero today, seven free days and the later recurring charge in %s', locale => {
    const html = render(createElement(ProductShowcase, { product, taxMode: 'local' }), locale);
    expect(html).toContain(locale === 'pl' ? 'Dzisiaj' : 'Today');
    expect(html).toContain(locale === 'pl' ? '7 dni za darmo' : '7 days free');
    expect(html).toContain(locale === 'pl' ? '11,00' : '11.00');
    expect(html).toContain(locale === 'pl' ? 'automatycznie' : 'automatically');
  });
  it('puts post-trial net and VAT next to the later price, not the zero due today', () => {
    const html = render(createElement(OrderSummary, { productName: 'Trial course', currency: 'PLN', basePrice: 11, discountAmount: 0, totalGross: 13.53, totalNet: 11, vatRate: 23, taxMode: 'local', intervalLabel: 'mies.', trialDays: 7 }), 'pl');
    expect(html).toContain('Dzisiaj'); expect(html).toContain('Po okresie próbnym');
    expect(html).toMatch(/data-testid="order-summary-total"[^>]*>0,00/);
    expect(html).toContain('13,53'); expect(html).toContain('11,00'); expect(html).toContain('23%');
  });
  it('keeps a regular subscription free of trial or zero-today claims', () => {
    const html = render(createElement(ProductShowcase, { product: { ...product, trial_days: null }, taxMode: 'local' }), 'pl');
    expect(html).not.toContain('Dzisiaj'); expect(html).not.toContain('dni za darmo'); expect(html).toContain('11,00');
  });
});
