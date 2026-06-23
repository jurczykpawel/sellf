import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { buildTaxSnapshotFromInvoice, captureAndPersistInvoiceTax } from '@/lib/services/tax-snapshot';

/** Minimal Stripe.Invoice fixture for the order-level normalizer. */
function fakeInvoice(o: Record<string, unknown>): Stripe.Invoice {
  return {
    id: 'in_test',
    currency: 'pln',
    total_excluding_tax: 10000,
    total: 12300,
    total_taxes: [
      { amount: 2300, tax_behavior: 'exclusive', taxability_reason: 'standard_rated', taxable_amount: 10000, tax_rate_details: { tax_rate: 'txr_1' } },
    ],
    automatic_tax: { enabled: false },
    ...o,
  } as unknown as Stripe.Invoice;
}

describe('buildTaxSnapshotFromInvoice', () => {
  it('netto (exclusive) 23% → net/tax/rate captured', () => {
    const snap = buildTaxSnapshotFromInvoice(fakeInvoice({}));
    expect(snap.netTotal).toBe(10000);
    expect(snap.taxTotal).toBe(2300);
    expect(snap.status).toBe('captured');
    expect(snap.stripeTaxApplied).toBe(false);
    expect(snap.lines[0].vatRate).toBe(23);
    expect(snap.lines[0].taxBehavior).toBe('exclusive');
    expect(snap.lines[0].taxabilityReason).toBe('standard_rated');
  });

  it('brutto (inclusive) → behavior inclusive', () => {
    const snap = buildTaxSnapshotFromInvoice(fakeInvoice({
      total_taxes: [{ amount: 2300, tax_behavior: 'inclusive', taxability_reason: 'standard_rated', taxable_amount: 10000 }],
    }));
    expect(snap.lines[0].taxBehavior).toBe('inclusive');
    expect(snap.lines[0].vatRate).toBe(23);
  });

  it('no tax → status none, taxTotal 0 (from total - net)', () => {
    const snap = buildTaxSnapshotFromInvoice(fakeInvoice({ total_taxes: [], total: 10000 }));
    expect(snap.taxTotal).toBe(0);
    expect(snap.status).toBe('none');
  });

  it('missing net (total_excluding_tax null) → unavailable', () => {
    const snap = buildTaxSnapshotFromInvoice(fakeInvoice({ total_excluding_tax: null }));
    expect(snap.netTotal).toBeNull();
    expect(snap.status).toBe('unavailable');
  });

  it('automatic_tax enabled → stripeTaxApplied true', () => {
    const snap = buildTaxSnapshotFromInvoice(fakeInvoice({ automatic_tax: { enabled: true } }));
    expect(snap.stripeTaxApplied).toBe(true);
  });

  it('multiple tax components → vatRate null, totals summed', () => {
    const snap = buildTaxSnapshotFromInvoice(fakeInvoice({
      total_excluding_tax: 15000,
      total: 16500,
      total_taxes: [
        { amount: 1000, tax_behavior: 'exclusive', taxability_reason: 'standard_rated', taxable_amount: 10000 },
        { amount: 500, tax_behavior: 'exclusive', taxability_reason: 'standard_rated', taxable_amount: 5000 },
      ],
    }));
    expect(snap.taxTotal).toBe(1500);
    expect(snap.lines[0].vatRate).toBeNull();
  });
});

describe('captureAndPersistInvoiceTax — fail-safe (never blocks billing)', () => {
  function fakeSupabase() {
    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const client = {
      from(table: string) {
        return {
          update(values: Record<string, unknown>) {
            return { eq: async () => { updates.push({ table, values }); return { data: null, error: null }; } };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;
    return { client, updates };
  }

  it('no transactionId → undefined, no DB write', async () => {
    const { client, updates } = fakeSupabase();
    const res = await captureAndPersistInvoiceTax({ supabase: client, invoice: fakeInvoice({}), transactionId: null });
    expect(res).toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  it('persists order-level net/tax/status and returns the snapshot', async () => {
    const { client, updates } = fakeSupabase();
    const res = await captureAndPersistInvoiceTax({ supabase: client, invoice: fakeInvoice({}), transactionId: 'tx_1' });
    expect(res?.netTotal).toBe(10000);
    expect(updates).toEqual([
      { table: 'payment_transactions', values: { net_total: 10000, tax_total: 2300, tax_snapshot_status: 'captured' } },
    ]);
  });
});
