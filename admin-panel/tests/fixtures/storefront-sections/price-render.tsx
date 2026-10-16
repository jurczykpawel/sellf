/** Shared Node/Chromium price rendering fixture. */
import { createElement } from 'react';
import { formatPrice } from '@/lib/constants';

export const PRICE_AMOUNTS = [49.99, 12345.67];

export function PriceFixture() {
  return createElement('div', null, ...(['pl', 'en'] as const).flatMap(locale =>
    PRICE_AMOUNTS.map(amount => createElement('span', {
      key: `${locale}/${amount}`, 'data-price': `${locale}/${amount}`,
    }, formatPrice(amount, 'PLN', locale)))));
}
