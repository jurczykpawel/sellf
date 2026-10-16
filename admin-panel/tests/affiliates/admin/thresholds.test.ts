import { expect, it } from 'vitest';
import { displayThreshold, parseThreshold } from '@/components/affiliates/admin/thresholds';
it('keeps seller currency input exact, including comma and amounts above safe integer range', () => {
  expect(displayThreshold('10000', 'PLN')).toBe('100.00'); expect(parseThreshold('100,25', 'PLN')).toBe('10025');
  expect(parseThreshold('90071992547409.93', 'EUR')).toBe('9007199254740993'); expect(displayThreshold('9007199254740993', 'EUR')).toBe('90071992547409.93');
  expect(parseThreshold('2500', 'JPY')).toBe('2500'); expect(displayThreshold('2500', 'KRW')).toBe('2500');
});
it('rejects fractional minor units, exponent syntax and out of range values', () => {
  for (const value of ['1.001', '-1', '1e3', '92233720368547758.08', '']) expect(parseThreshold(value, 'PLN')).toBeNull();
  expect(parseThreshold('1.1', 'JPY')).toBeNull();
});
