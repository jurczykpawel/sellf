import { expect, it } from 'vitest';
import { parsePayoutAmount } from '@/lib/affiliates/payouts/display';
it('reads ordinary money fields as exact minor strings', () => {
  expect(parsePayoutAmount('24,60', 'PLN')).toBe('2460');
  expect(parsePayoutAmount('90071992547409.93', 'EUR')).toBe('9007199254740993');
  expect(parsePayoutAmount('-12.50', 'PLN')).toBe('-1250');
  expect(parsePayoutAmount('2000', 'JPY')).toBe('2000');
  for (const v of ['1.001', 'NaN', '1e4', '92233720368547758.08']) expect(parsePayoutAmount(v, 'PLN')).toBeNull();
});
