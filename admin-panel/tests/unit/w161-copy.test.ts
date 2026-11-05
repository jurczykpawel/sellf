import { expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

it('uses English examples and tax terminology in English checkout', () => {
  expect(en.checkout.fullNamePlaceholder).toBe('John Smith');
  expect(en.checkout.nipLabel).toBe('Tax ID');
});
it('uses consistent Polish license terminology', () => {
  expect(pl.productView.licenseStatusRevoked).toBe('Cofnięta');
});
