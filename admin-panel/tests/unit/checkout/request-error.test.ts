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
