import { describe, it, expect } from 'vitest';
import { shouldWarnExemptIgnoredUnderStripeTax } from '@/lib/settings/tax-mode-warnings';

describe('shouldWarnExemptIgnoredUnderStripeTax', () => {
  it('warns only when the shop is VAT-exempt AND in Stripe Tax mode', () => {
    expect(shouldWarnExemptIgnoredUnderStripeTax({ isVatExempt: true, taxMode: 'stripe_tax' })).toBe(true);
  });
  it('no warning in local (Fixed Rate) mode — exemption is honored there', () => {
    expect(shouldWarnExemptIgnoredUnderStripeTax({ isVatExempt: true, taxMode: 'local' })).toBe(false);
  });
  it('no warning when the shop is not exempt', () => {
    expect(shouldWarnExemptIgnoredUnderStripeTax({ isVatExempt: false, taxMode: 'stripe_tax' })).toBe(false);
    expect(shouldWarnExemptIgnoredUnderStripeTax({ isVatExempt: null, taxMode: 'stripe_tax' })).toBe(false);
    expect(shouldWarnExemptIgnoredUnderStripeTax({ taxMode: 'stripe_tax' })).toBe(false);
  });
});
