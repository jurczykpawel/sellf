import { expect, it } from 'vitest';
import { productOptionLabel } from '@/lib/access/product-option-label';

const text = { free: 'Darmowy', subscription: 'Subskrypcja' };
it('labels a free product in the interface language (W224-B11)', () => {
  expect(productOptionLabel({ name: 'Ebook', price: 0, currency: 'PLN', product_type: 'one_time' }, 'pl', text)).toBe('Ebook (Darmowy)');
});
it('does not call a subscription with a zero start price free', () => {
  expect(productOptionLabel({ name: 'Klub', price: 0, currency: 'PLN', product_type: 'subscription' }, 'pl', text)).toBe('Klub (Subskrypcja)');
});
it('shows the price of a paid product', () => {
  expect(productOptionLabel({ name: 'Kurs', price: 49, currency: 'PLN' }, 'pl', text)).toMatch(/^Kurs \(.*49.*\)$/);
});
