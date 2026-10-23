import { describe, expect, it } from 'vitest';
import { parseQuantityInput } from '@/lib/checkout-modules/quantity';

const config = { id: 'quantity', min: 2, max: 5, mode: 'checkout' } as const;
describe('quantity input', () => {
  it.each(['0', '-1', '', ' ', 'abc', '2.5', '6', 'Infinity', '1'])('rejects %j before pricing', value => {
    expect(parseQuantityInput(value, config)).toBeNull();
  });
  it.each(['2', '3', '5'])('accepts %j within configured limits', value => {
    expect(parseQuantityInput(value, config)).toBe(Number(value));
  });
});
