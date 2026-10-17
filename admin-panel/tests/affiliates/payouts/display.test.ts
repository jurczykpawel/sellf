import { expect, it } from 'vitest';
import { parsePayoutAmount } from '@/lib/affiliates/payouts/display';
it('reads ordinary money fields as exact minor strings', () => {
  expect(parsePayoutAmount('24,60', 'PLN')).toBe('2460');
  expect(parsePayoutAmount('90071992547409.93', 'EUR')).toBe('9007199254740993');
  expect(parsePayoutAmount('-12.50', 'PLN')).toBe('-1250');
  expect(parsePayoutAmount('2000', 'JPY')).toBe('2000');
  for (const v of ['1.001', 'NaN', '1e4', '92233720368547758.08']) expect(parsePayoutAmount(v, 'PLN')).toBeNull();
});

import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { currencyExponent } from '@/lib/currency/minor-units';
it.each(SUPPORTED_CURRENCY_CODES)('accepts exact payout input for %s', currency => {
  const zero = currencyExponent(currency) === 0;
  expect(parsePayoutAmount(zero ? '1234' : '12,34', currency)).toBe('1234');
  expect(parsePayoutAmount(zero ? '1.1' : '1.001', currency)).toBeNull();
});
it('rejects unsupported payout currencies', () => expect(parsePayoutAmount('12', 'XYZ')).toBeNull());
