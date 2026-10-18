import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import ProductShowcase from '@/app/[locale]/checkout/[slug]/components/ProductShowcase';
import type { Product } from '@/types';

function render(product: Partial<Product>): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'pl', messages: { productView: { free: 'ZA DARMO' }, checkout: {} }, onError: () => {}, getMessageFallback: ({ key }: { key: string }) => key },
      createElement(ProductShowcase, {
        product: { id: 'p', name: 'Free', slug: 'free', description: '', currency: 'USD', price: 0, allow_custom_price: false, ...product } as Product,
        taxMode: 'local',
      }),
    ),
  );
}

describe('ProductShowcase price', () => {
  it('shows the free label, not a zero amount, for a free product', () => {
    const html = render({});
    expect(html).toContain('ZA DARMO');
    expect(html).not.toMatch(/0,00/);
  });

  it('still shows the amount for a paid product', () => {
    expect(render({ price: 99, currency: 'PLN' })).toMatch(/99,00/);
  });
});
