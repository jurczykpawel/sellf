import { describe, it, expect } from 'vitest';
import { selectLowestPriorPrice } from '@/lib/services/omnibus';

/**
 * EU Omnibus Directive (2019/2161) — the "prior price" reference must be the
 * lowest price applied in the 30 days BEFORE the current reduction. The current
 * reduction (the sale being announced now) must be EXCLUDED, otherwise the
 * "lowest price" always collapses to the current sale price (which is, by
 * definition, the lowest), making the disclosure meaningless and non-compliant.
 *
 * `selectLowestPriorPrice` operates on the already-30-day-windowed price history
 * (the SQL query applies the date cutoff). Rows model price periods; the most
 * recent period (max effective_from) is the current reduction.
 *
 * Helper builds entries newest-first (the service queries effective_from DESC),
 * but the function must not depend on input ordering.
 */
type Entry = {
  price: string;
  sale_price: string | null;
  currency: string;
  effective_from: string;
};

const ISO = (daysAgo: number): string =>
  new Date(Date.UTC(2026, 5, 28) - daysAgo * 86_400_000).toISOString();

const entry = (
  price: number,
  sale_price: number | null,
  effective_from: string,
  currency = 'PLN',
): Entry => ({
  price: String(price),
  sale_price: sale_price === null ? null : String(sale_price),
  currency,
  effective_from,
});

describe('selectLowestPriorPrice (Omnibus prior-price reference)', () => {
  it('returns null for empty history', () => {
    expect(selectLowestPriorPrice([])).toBeNull();
  });

  it('canonical case: regular 49 then a 29 sale → 49 (NOT 29)', () => {
    // The bug: current sale (29) was counted as the prior reference.
    const history = [
      entry(49, 29, ISO(0)), // current period (sale just set)
      entry(49, null, ISO(2)), // pre-sale regular period
    ];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(49);
  });

  it('launched on sale (single open row {49,29}) → 49', () => {
    const history = [entry(49, 29, ISO(0))];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(49);
  });

  it('only the current period remains after 30-day cleanup → regular price', () => {
    const history = [entry(49, 29, ISO(0))];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(49);
  });

  it('genuine past flash sale (39) that ended, now sale 29 → 39', () => {
    const history = [
      entry(49, 29, ISO(0)), // current sale
      entry(49, null, ISO(3)), // back to regular
      entry(49, 39, ISO(10)), // past flash sale (genuinely applied)
      entry(49, null, ISO(20)), // original regular
    ];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(39);
  });

  it('past sale (25) lower than current sale (29) → 25 (reference is the genuine lower)', () => {
    const history = [
      entry(49, 29, ISO(0)), // current sale
      entry(49, 25, ISO(8)), // earlier genuine sale, lower than current
    ];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(25);
  });

  it('no active sale, only regular price drops 100 → 80 → 80', () => {
    const history = [entry(80, null, ISO(0)), entry(100, null, ISO(5))];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(80);
  });

  it('masking scenario 100 → 80 → (120 + sale 90) still resolves to 80', () => {
    // The previously-passing integration test; lowest genuine regular is 80.
    const history = [
      entry(120, 90, ISO(0)), // current: regular 120 (sale 90 excluded)
      entry(80, null, ISO(3)),
      entry(100, null, ISO(6)),
    ];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(80);
  });

  it('tie: insert {49,null} + sale {49,29} share the same effective_from → 49', () => {
    // Same-transaction edge: both rows carry the current timestamp; keying the
    // current period by max(effective_from) excludes the sale on BOTH.
    const sameTs = ISO(0);
    const history = [entry(49, null, sameTs), entry(49, 29, sameTs)];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(49);
  });

  it('is independent of input ordering (oldest-first yields the same result)', () => {
    const oldestFirst = [
      entry(49, null, ISO(20)),
      entry(49, 39, ISO(10)),
      entry(49, null, ISO(3)),
      entry(49, 29, ISO(0)),
    ];
    expect(selectLowestPriorPrice(oldestFirst)?.lowestPrice).toBe(39);
  });

  it('current regular price can be the lowest reference when it dropped below history', () => {
    // Regular dropped to 30 and a 20 sale announced; 30 (current regular) is the
    // lowest prior reference vs an older 49 regular.
    const history = [entry(30, 20, ISO(0)), entry(49, null, ISO(5))];
    expect(selectLowestPriorPrice(history)?.lowestPrice).toBe(30);
  });

  it('propagates the currency of the chosen entry', () => {
    const history = [entry(49, 29, ISO(0), 'EUR'), entry(49, null, ISO(2), 'EUR')];
    const result = selectLowestPriorPrice(history);
    expect(result?.currency).toBe('EUR');
    expect(result?.lowestPrice).toBe(49);
  });

  it('returns effectiveFrom as a Date of the chosen entry', () => {
    const history = [entry(49, 29, ISO(0)), entry(49, 39, ISO(8))];
    const result = selectLowestPriorPrice(history);
    expect(result?.lowestPrice).toBe(39);
    expect(result?.effectiveFrom).toBeInstanceOf(Date);
    expect(result?.effectiveFrom.toISOString()).toBe(ISO(8));
  });
});
