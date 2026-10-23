import { expect, it } from 'vitest';
import { couponValueError } from '@/lib/coupons/validate-value';
it('accepts set price and zero, requires currency and integer JPY', () => {
  expect(couponValueError('set_price', 30, 'PLN')).toBeNull();
  expect(couponValueError('set_price', 0, 'PLN')).toBeNull();
  for (const [type, value, currency] of [['unknown', 30, 'PLN'], ['fixed', 0, 'PLN'], ['set_price', -1, 'PLN'], ['set_price', 30, null], ['set_price', 30.5, 'JPY'], ['set_price', 30, 'ZZZ']] as const) {
    expect(couponValueError(type, value, currency)).toBeTruthy();
  }
});
