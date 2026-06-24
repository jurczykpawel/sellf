import { describe, it, expect } from 'vitest';
import { isStripeTaxNotConfiguredError } from '@/lib/stripe/tax-errors';

describe('isStripeTaxNotConfiguredError', () => {
  it('detects the real Stripe automatic-tax head-office rejection', () => {
    const err = {
      type: 'StripeInvalidRequestError',
      message:
        'You must have a valid head office address to enable automatic tax calculation in test mode.  Visit https://dashboard.stripe.com/test/settings/tax to update it.',
    };
    expect(isStripeTaxNotConfiguredError(err)).toBe(true);
  });

  it('detects origin-address / automatic-tax phrasings', () => {
    expect(isStripeTaxNotConfiguredError({ type: 'StripeInvalidRequestError', message: 'Missing origin address for automatic tax' })).toBe(true);
    expect(isStripeTaxNotConfiguredError({ type: 'StripeInvalidRequestError', message: 'automatic tax cannot be enabled' })).toBe(true);
  });

  it('ignores unrelated Stripe errors', () => {
    expect(isStripeTaxNotConfiguredError({ type: 'StripeInvalidRequestError', message: 'No such customer: cus_x' })).toBe(false);
    expect(isStripeTaxNotConfiguredError({ type: 'StripeCardError', message: 'head office address' })).toBe(false);
  });

  it('is safe on non-Stripe / null inputs', () => {
    expect(isStripeTaxNotConfiguredError(null)).toBe(false);
    expect(isStripeTaxNotConfiguredError(undefined)).toBe(false);
    expect(isStripeTaxNotConfiguredError(new Error('head office address'))).toBe(false);
    expect(isStripeTaxNotConfiguredError('string')).toBe(false);
  });
});
