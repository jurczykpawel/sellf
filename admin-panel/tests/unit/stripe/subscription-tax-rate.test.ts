import { describe, it, expect, vi } from 'vitest';
import { resolveLocalSubscriptionTaxRateId } from '@/lib/stripe/tax-rate-manager';

/**
 * Unit tests for the shared subscription tax-rate gate. Mirrors the one-time line
 * builder: a manual Stripe TaxRate is attached ONLY for a real (>0) rate on a
 * NON-exempt product, and only in local mode. The resolver is injected so no Stripe
 * call happens.
 */
describe('resolveLocalSubscriptionTaxRateId', () => {
  const resolver = () => vi.fn(async (p: { percentage: number; inclusive: boolean }) => `txr_${p.percentage}_${p.inclusive ? 'inc' : 'exc'}`);

  it('stripe_tax mode → no manual rate (Stripe Tax computes); resolver not called', async () => {
    const r = resolver();
    const id = await resolveLocalSubscriptionTaxRateId(
      { taxMode: 'stripe_tax', vatRate: 23, priceIncludesVat: true, vatExempt: false },
      r,
    );
    expect(id).toBeUndefined();
    expect(r).not.toHaveBeenCalled();
  });

  it('local + VAT-exempt → no manual rate even with a non-zero rate (the fix); resolver not called', async () => {
    const r = resolver();
    const id = await resolveLocalSubscriptionTaxRateId(
      { taxMode: 'local', vatRate: 23, priceIncludesVat: true, vatExempt: true },
      r,
    );
    expect(id).toBeUndefined();
    expect(r).not.toHaveBeenCalled();
  });

  it('local + 0 rate → no manual rate', async () => {
    const r = resolver();
    expect(await resolveLocalSubscriptionTaxRateId({ taxMode: 'local', vatRate: 0, priceIncludesVat: false, vatExempt: false }, r)).toBeUndefined();
    expect(r).not.toHaveBeenCalled();
  });

  it('local + null rate → no manual rate', async () => {
    const r = resolver();
    expect(await resolveLocalSubscriptionTaxRateId({ taxMode: 'local', vatRate: null, priceIncludesVat: false, vatExempt: false }, r)).toBeUndefined();
    expect(r).not.toHaveBeenCalled();
  });

  it('local + brutto (price includes VAT) → inclusive rate', async () => {
    const r = resolver();
    const id = await resolveLocalSubscriptionTaxRateId(
      { taxMode: 'local', vatRate: 23, priceIncludesVat: true, vatExempt: false },
      r,
    );
    expect(r).toHaveBeenCalledWith({ percentage: 23, inclusive: true });
    expect(id).toBe('txr_23_inc');
  });

  it('local + netto (price excludes VAT) → exclusive rate', async () => {
    const r = resolver();
    const id = await resolveLocalSubscriptionTaxRateId(
      { taxMode: 'local', vatRate: 23, priceIncludesVat: false, vatExempt: false },
      r,
    );
    expect(r).toHaveBeenCalledWith({ percentage: 23, inclusive: false });
    expect(id).toBe('txr_23_exc');
  });
});
