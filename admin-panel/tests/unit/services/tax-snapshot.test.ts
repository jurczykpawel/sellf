import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  buildTaxSnapshotFromCheckoutLines,
  matchSnapshotLinesToRows,
  captureAndPersistOrderTax,
} from '@/lib/services/tax-snapshot';
import type { LineTaxSnapshot, LineRow } from '@/lib/services/tax-snapshot';

/** Build a minimal Stripe.LineItem fixture for the normalizer. */
function makeLine(opts: {
  productId?: string;
  isBump?: boolean;
  netAmount?: number | null;
  taxAmount?: number | null;
  grossAmount?: number | null;
  taxes?: Array<{
    amount: number;
    taxable_amount: number;
    taxability_reason?: string | null;
    percentage?: number;
    effective_percentage?: number;
    inclusive?: boolean;
    tax_type?: string;
    jurisdiction?: string | null;
    country?: string | null;
    state?: string | null;
  }>;
}): Stripe.LineItem {
  const metadata: Record<string, string> = {};
  if (opts.productId) metadata.product_id = opts.productId;
  if (opts.isBump) metadata.is_bump = 'true';
  return {
    id: 'li_test',
    amount_subtotal: opts.netAmount ?? 0,
    amount_tax: opts.taxAmount ?? 0,
    amount_total: opts.grossAmount ?? 0,
    currency: 'pln',
    price: { product: { metadata } },
    taxes: (opts.taxes ?? []).map((t) => ({
      amount: t.amount,
      taxable_amount: t.taxable_amount,
      taxability_reason: t.taxability_reason ?? null,
      rate: {
        percentage: t.percentage ?? 0,
        effective_percentage: t.effective_percentage ?? t.percentage ?? 0,
        inclusive: t.inclusive ?? false,
        tax_type: t.tax_type ?? 'vat',
        jurisdiction: t.jurisdiction ?? null,
        country: t.country ?? null,
        state: t.state ?? null,
      },
    })),
  } as unknown as Stripe.LineItem;
}

describe('buildTaxSnapshotFromCheckoutLines', () => {
  it('single line, one 23% exclusive component → derived vatRate + captured', () => {
    const line = makeLine({
      productId: 'p1',
      netAmount: 10000,
      taxAmount: 2300,
      grossAmount: 12300,
      taxes: [{ amount: 2300, taxable_amount: 10000, percentage: 23, taxability_reason: 'standard_rated', jurisdiction: 'PL', country: 'PL' }],
    });
    const snap = buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 10000, amountTax: 2300, currency: 'pln' });
    expect(snap.status).toBe('captured');
    expect(snap.taxTotal).toBe(2300);
    expect(snap.netTotal).toBe(10000);
    expect(snap.lines).toHaveLength(1);
    const l = snap.lines[0];
    expect(l.productId).toBe('p1');
    expect(l.isBump).toBe(false);
    expect(l.netAmount).toBe(10000);
    expect(l.taxAmount).toBe(2300);
    expect(l.grossAmount).toBe(12300);
    expect(l.vatRate).toBe(23);
    expect(l.taxBehavior).toBe('exclusive');
    expect(l.taxabilityReason).toBe('standard_rated');
    expect(l.breakdown).toHaveLength(1);
  });

  it('stripeTaxApplied reflects automaticTaxEnabled (default false)', () => {
    const line = makeLine({ productId: 'p1', netAmount: 10000, taxAmount: 2300, grossAmount: 12300, taxes: [{ amount: 2300, taxable_amount: 10000, percentage: 23 }] });
    expect(buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 10000, amountTax: 2300, currency: 'pln' }).stripeTaxApplied).toBe(false);
    expect(buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 10000, amountTax: 2300, currency: 'pln', automaticTaxEnabled: true }).stripeTaxApplied).toBe(true);
  });

  it('single line, zero components, zero tax → vatRate null, status none', () => {
    const line = makeLine({ productId: 'p1', netAmount: 5000, taxAmount: 0, grossAmount: 5000, taxes: [] });
    const snap = buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 5000, amountTax: 0, currency: 'pln' });
    expect(snap.status).toBe('none');
    expect(snap.lines[0].vatRate).toBeNull();
    expect(snap.lines[0].taxBehavior).toBeNull();
    expect(snap.lines[0].breakdown).toEqual([]);
  });

  it('multi-component line (country + state) → vatRate null, breakdown kept, tax from amount_tax', () => {
    const line = makeLine({
      productId: 'p1',
      netAmount: 10000,
      taxAmount: 925, // 6.25% + 3% on 10000, Stripe-rounded
      grossAmount: 10925,
      taxes: [
        { amount: 625, taxable_amount: 10000, percentage: 6.25, tax_type: 'sales_tax', jurisdiction: 'US', country: 'US' },
        { amount: 300, taxable_amount: 10000, percentage: 3, tax_type: 'sales_tax', jurisdiction: 'TX', country: 'US', state: 'TX' },
      ],
    });
    const snap = buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 10000, amountTax: 925, currency: 'usd' });
    expect(snap.lines[0].vatRate).toBeNull(); // never sum percentages
    expect(snap.lines[0].breakdown).toHaveLength(2);
    expect(snap.lines[0].taxAmount).toBe(925);
    expect(snap.status).toBe('captured');
  });

  it('inclusive line → taxBehavior inclusive, vatRate from effective_percentage', () => {
    const line = makeLine({
      productId: 'p1',
      netAmount: 8130,
      taxAmount: 1870,
      grossAmount: 10000,
      taxes: [{ amount: 1870, taxable_amount: 8130, percentage: 23, effective_percentage: 23, inclusive: true }],
    });
    const snap = buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 8130, amountTax: 1870, currency: 'pln' });
    expect(snap.lines[0].taxBehavior).toBe('inclusive');
    expect(snap.lines[0].vatRate).toBe(23);
  });

  it('bump line → isBump true, productId from metadata', () => {
    const main = makeLine({ productId: 'main', netAmount: 10000, taxAmount: 2300, taxes: [{ amount: 2300, taxable_amount: 10000, percentage: 23 }] });
    const bump = makeLine({ productId: 'bump', isBump: true, netAmount: 5000, taxAmount: 0, taxes: [] });
    const snap = buildTaxSnapshotFromCheckoutLines([main, bump], { amountSubtotal: 15000, amountTax: 2300, currency: 'pln' });
    expect(snap.lines[1].isBump).toBe(true);
    expect(snap.lines[1].productId).toBe('bump');
    expect(snap.lines[0].isBump).toBe(false);
  });

  it('uncomputed tax (amountTax null) → status unavailable', () => {
    const line = makeLine({ productId: 'p1', netAmount: 10000, taxAmount: null, taxes: [] });
    const snap = buildTaxSnapshotFromCheckoutLines([line], { amountSubtotal: 10000, amountTax: null, currency: 'pln' });
    expect(snap.status).toBe('unavailable');
  });
});

describe('matchSnapshotLinesToRows', () => {
  function snapLine(productId: string | null, isBump = false): LineTaxSnapshot {
    return {
      productId,
      isBump,
      netAmount: 100,
      taxAmount: 23,
      grossAmount: 123,
      vatRate: 23,
      taxBehavior: 'exclusive',
      taxabilityReason: null,
      breakdown: [],
    };
  }
  function row(id: string, product_id: string | null, item_type: LineRow['item_type'] = 'main_product'): LineRow {
    return { id, product_id, item_type };
  }

  it('matches by product_id across main + bump → complete', () => {
    const lines = [snapLine('main'), snapLine('bump', true)];
    const rows = [row('r1', 'main'), row('r2', 'bump', 'order_bump')];
    const { pairs, complete } = matchSnapshotLinesToRows(lines, rows);
    expect(complete).toBe(true);
    expect(pairs).toHaveLength(2);
    expect(pairs.find((p) => p.row.id === 'r1')?.line.productId).toBe('main');
    expect(pairs.find((p) => p.row.id === 'r2')?.line.productId).toBe('bump');
  });

  it('product_id present but fewer lines than rows → incomplete (no safe per-line write)', () => {
    const lines = [snapLine('main')];
    const rows = [row('r1', 'main'), row('r2', 'bump', 'order_bump')];
    const { complete } = matchSnapshotLinesToRows(lines, rows);
    expect(complete).toBe(false);
  });

  it('no product_id metadata but equal counts → positional, complete', () => {
    const lines = [snapLine(null), snapLine(null)];
    const rows = [row('r1', 'main'), row('r2', 'bump', 'order_bump')];
    const { pairs, complete } = matchSnapshotLinesToRows(lines, rows);
    expect(complete).toBe(true);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].row.id).toBe('r1');
    expect(pairs[1].row.id).toBe('r2');
  });

  it('no product_id + count mismatch → cannot match safely (incomplete, no pairs)', () => {
    const lines = [snapLine(null)];
    const rows = [row('r1', 'main'), row('r2', 'bump', 'order_bump')];
    const { pairs, complete } = matchSnapshotLinesToRows(lines, rows);
    expect(complete).toBe(false);
    expect(pairs).toHaveLength(0);
  });
});

describe('captureAndPersistOrderTax — fail-safe (never blocks payment)', () => {
  function fakeSupabase() {
    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const client = {
      from(table: string) {
        return {
          update(values: Record<string, unknown>) {
            return {
              eq: async () => {
                updates.push({ table, values });
                return { data: null, error: null };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;
    return { client, updates };
  }

  const throwingStripe = {
    checkout: {
      sessions: {
        listLineItems: async () => {
          throw new Error('stripe boom');
        },
        retrieve: async () => ({}),
      },
    },
  } as unknown as Stripe;

  it('no transactionId → undefined, no DB writes', async () => {
    const { client, updates } = fakeSupabase();
    const res = await captureAndPersistOrderTax({
      stripe: throwingStripe,
      supabase: client,
      transactionId: null,
      sessionId: 'cs_1',
    });
    expect(res).toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  it('missing sessionId → marks unavailable, returns undefined', async () => {
    const { client, updates } = fakeSupabase();
    const res = await captureAndPersistOrderTax({
      stripe: throwingStripe,
      supabase: client,
      transactionId: 'tx_1',
      sessionId: null,
    });
    expect(res).toBeUndefined();
    expect(updates).toEqual([{ table: 'payment_transactions', values: { tax_snapshot_status: 'unavailable' } }]);
  });

  it('Stripe error → never throws, marks unavailable, returns undefined', async () => {
    const { client, updates } = fakeSupabase();
    const res = await captureAndPersistOrderTax({
      stripe: throwingStripe,
      supabase: client,
      transactionId: 'tx_1',
      sessionId: 'cs_1',
    });
    expect(res).toBeUndefined();
    expect(updates).toEqual([{ table: 'payment_transactions', values: { tax_snapshot_status: 'unavailable' } }]);
  });
});
