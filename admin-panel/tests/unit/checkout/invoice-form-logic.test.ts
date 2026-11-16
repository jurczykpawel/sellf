import { describe, it, expect } from 'vitest';
import { shouldForwardTaxIdentityToStripe } from '@/lib/checkout/invoice-form-logic';

describe('shouldForwardTaxIdentityToStripe', () => {
  it('only in stripe_tax mode', () => {
    expect(shouldForwardTaxIdentityToStripe('stripe_tax')).toBe(true);
    expect(shouldForwardTaxIdentityToStripe('local')).toBe(false);
    expect(shouldForwardTaxIdentityToStripe(undefined)).toBe(false);
  });
});
