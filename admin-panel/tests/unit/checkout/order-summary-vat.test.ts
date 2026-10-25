/**
 * The checkout total line must match what Stripe charges: an exempt product keeps its
 * vat_rate column (e.g. 23) but the charge carries no tax, so it must be labelled exempt
 * instead of "Net price … + VAT 23%".
 *
 * Rendered with renderToStaticMarkup (same approach as bundle-contents-preview.test.ts),
 * using the real message catalogues so a missing translation key fails here too.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import OrderSummary from '@/components/checkout/OrderSummary';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

type SummaryProps = Parameters<typeof OrderSummary>[0];

function render(overrides: Partial<SummaryProps>, locale: 'en' | 'pl' = 'en'): string {
  const props: SummaryProps = {
    productName: 'Sellf Pro',
    currency: 'USD',
    basePrice: 59,
    discountAmount: 0,
    totalGross: 59,
    totalNet: 47.97,
    vatRate: 23,
    taxMode: 'local',
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === 'pl' ? pl : en },
      createElement(OrderSummary, props),
    ),
  );
}

describe('OrderSummary VAT line', () => {
  it('shows net + VAT for a taxable product', () => {
    const html = render({ vatExempt: false });
    expect(html).toContain('Net price');
    expect(html).toContain('VAT 23%');
    expect(html).not.toContain(en.checkout.vatExempt);
  });

  it('labels an exempt product as exempt, without the stored rate', () => {
    const html = render({ vatExempt: true });
    expect(html).toContain(en.checkout.vatExempt);
    expect(html).not.toContain('VAT 23%');
    expect(html).not.toContain('Net price');
  });

  it('appends the exemption basis when the seller set one (PL)', () => {
    const html = render({ vatExempt: true, vatExemptNote: 'art. 113 ust. 1 ustawy o VAT' }, 'pl');
    expect(html).toContain(`${pl.checkout.vatExempt} (art. 113 ust. 1 ustawy o VAT)`);
    expect(html).not.toContain('VAT 23%');
  });

  it('shows no VAT line in Stripe Tax mode, exempt or not', () => {
    for (const vatExempt of [true, false]) {
      const html = render({ vatExempt, taxMode: 'stripe_tax' });
      expect(html).not.toContain('VAT 23%');
      expect(html).not.toContain(en.checkout.vatExempt);
    }
  });
});

describe('OrderSummary total with an invalid custom amount', () => {
  it('shows a dash and the invalid-amount hint instead of a struck-through number', () => {
    const html = render({ totalGross: 5, customAmountError: 'invalid', intervalLabel: 'month' }, 'pl');
    const total = html.match(/data-testid="order-summary-total"[^>]*>(.*?)<\/div>/)?.[1] ?? '';
    expect(total).toBe('—');
    expect(html).not.toContain('line-through');
    expect(html).toContain(`(${pl.checkout.invalidAmount})`);
  });

  it('still shows the formatted total for a valid amount', () => {
    expect(render({ totalGross: 5 })).toContain('$5.00');
  });
});
