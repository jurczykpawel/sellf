import { describe, expect, it } from 'vitest';
import { moneyAmountError, parseMoneyInput } from '@/lib/currency/parse-money-input';

const ok = (raw: string, currency: string, locale: string) => {
  const r = parseMoneyInput(raw, currency, locale);
  return r.error ? r.error : r.value;
};

describe('parseMoneyInput', () => {
  it.each([
    ['1000', 'PLN', 'pl', 1000],
    ['1000,5', 'PLN', 'pl', 1000.5],
    ['1000.5', 'PLN', 'pl', 1000.5],
    ['1 000', 'PLN', 'pl', 1000],
    ['1 000,50', 'PLN', 'pl', 1000.5],
    ['1.000', 'PLN', 'pl', 1000],
    ['1.000,50', 'PLN', 'pl', 1000.5],
    ['1,000.50', 'USD', 'en', 1000.5],
    ['1,000', 'USD', 'en', 1000],
    ['1.5', 'USD', 'en', 1.5],
    ['1,5', 'USD', 'en', 1.5],
    ['1,000,000', 'USD', 'en', 1000000],
    ['12.34', 'EUR', 'en', 12.34],
    ['0,5', 'PLN', 'pl', 0.5],
    ['.5', 'USD', 'en', 0.5],
  ])('%s %s %s -> %s', (raw, cur, loc, expected) => {
    expect(ok(raw, cur, loc)).toBe(expected);
  });

  it.each([
    ['1000', 1000],
    ['1 000', 1000],
    ['1.000', 1000],
    ['1,000', 1000],
    ['1,000,000', 1000000],
    ['1000.00', 1000],
  ])('zero-decimal JPY accepts %s as %s', (raw, expected) => {
    expect(ok(raw, 'JPY', 'en')).toBe(expected);
    expect(ok(raw, 'JPY', 'pl')).toBe(expected);
  });

  it.each(['1000.5', '1000,5', '1,5', '1.5', '0.5', '1,000.5'])('zero-decimal JPY rejects fraction %s', (raw) => {
    expect(ok(raw, 'JPY', 'en')).toBe('fraction_not_allowed');
    expect(ok(raw, 'JPY', 'pl')).toBe('fraction_not_allowed');
  });

  it('rejects more than two decimals for two-decimal currencies', () => {
    expect(ok('1,234', 'PLN', 'pl')).toBe('too_many_decimals');
    expect(ok('0.125', 'USD', 'en')).toBe('too_many_decimals');
    expect(ok('1.2345', 'USD', 'en')).toBe('too_many_decimals');
  });

  it('rejects malformed separators', () => {
    expect(ok('1.2.3', 'USD', 'en')).toBe('invalid_format');
    expect(ok('1,00,0', 'USD', 'en')).toBe('invalid_format');
    expect(ok('1.000,00,0', 'PLN', 'pl')).toBe('invalid_format');
    expect(ok(',', 'PLN', 'pl')).toBe('invalid_format');
  });

  it('returns null value for empty input', () => {
    expect(parseMoneyInput('', 'USD', 'en')).toEqual({ value: null, error: null });
  });
});

describe('moneyAmountError', () => {
  it('flags fractions in zero-decimal currencies and extra decimals elsewhere', () => {
    expect(moneyAmountError(1000.5, 'JPY')).toBe('fraction_not_allowed');
    expect(moneyAmountError(1000, 'JPY')).toBeNull();
    expect(moneyAmountError(10.123, 'USD')).toBe('too_many_decimals');
    expect(moneyAmountError(10.5, 'USD')).toBeNull();
    expect(moneyAmountError(null, 'JPY')).toBeNull();
    expect(moneyAmountError(NaN, 'JPY')).toBeNull();
  });
});
