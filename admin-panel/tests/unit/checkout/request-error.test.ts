/** @see src/lib/checkout/request-error.ts */
import { createTranslator } from 'next-intl';
import { expect, it } from 'vitest';
import { getCheckoutRequestError } from '@/lib/checkout/request-error';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

it.each([['en', en], ['pl', pl]] as const)('maps checkout request limits using %s messages', (locale, messages) => {
  const t = createTranslator({ locale, messages, namespace: 'checkout' });
  expect(getCheckoutRequestError(429, 'Service request quota reached', t('loadError'), t('requestRateLimit')))
    .toBe(messages.checkout.requestRateLimit);
  expect(getCheckoutRequestError(400, 'Invalid request', t('loadError'), t('requestRateLimit'))).toBe('Invalid request');
  expect(getCheckoutRequestError(500, undefined, t('loadError'), t('requestRateLimit'))).toBe(t('loadError'));
});

it('never shows an English server text for server errors or known codes (W146 B6)', () => {
  expect(getCheckoutRequestError(500, 'Failed to create payment intent', 'Nie udało się', 'limit')).toBe('Nie udało się');
  expect(getCheckoutRequestError(409, 'Product price is below the minimum charge', 'Nie udało się', 'limit', { code: 'AMOUNT_BELOW_MINIMUM', messages: { AMOUNT_BELOW_MINIMUM: 'Produkt chwilowo niedostępny' } })).toBe('Produkt chwilowo niedostępny');
});
