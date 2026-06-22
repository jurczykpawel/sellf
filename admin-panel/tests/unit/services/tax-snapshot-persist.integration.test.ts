import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { persistTaxSnapshot, type OrderTaxSnapshot } from '@/lib/services/tax-snapshot';
import type { Database } from '@/types/database';

/**
 * Integration test: persistTaxSnapshot against the REAL local Supabase schema.
 * The unit tests cover the pure matcher with fakes; this verifies the actual
 * UPDATE writes the new tax columns + transaction status on the real tables,
 * and that per-line vat_exempt is sourced from the product.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

describe('persistTaxSnapshot (integration — real DB)', () => {
  const suffix = Date.now();
  let mainId: string;
  let bumpId: string;
  let txId: string;

  beforeAll(async () => {
    const { data: main, error: e1 } = await supabase
      .from('products')
      .insert({ name: 'TaxSnap Main', slug: `taxsnap-main-${suffix}`, description: 'x', price: 100, currency: 'PLN', is_active: true, vat_rate: 23, price_includes_vat: false, vat_exempt: false })
      .select('id')
      .single();
    if (e1) throw e1;
    mainId = main!.id;

    const { data: bump, error: e2 } = await supabase
      .from('products')
      .insert({ name: 'TaxSnap Bump', slug: `taxsnap-bump-${suffix}`, description: 'x', price: 50, currency: 'PLN', is_active: true, vat_exempt: true, vat_exempt_note: 'zw. art. 113' })
      .select('id')
      .single();
    if (e2) throw e2;
    bumpId = bump!.id;

    const { data: tx, error: e3 } = await supabase
      .from('payment_transactions')
      // created_at far in the past so this fixture is invisible to date-ranged
      // aggregate RPCs (get_payment_statistics etc.) that run in parallel — avoids
      // polluting their windows. persistTaxSnapshot ignores created_at.
      .insert({ customer_email: 'tax@e2e.test', product_id: mainId, amount: 17300, currency: 'PLN', session_id: `cs_taxsnap_${suffix}`, status: 'completed', created_at: '2015-06-15T00:00:00Z' })
      .select('id')
      .single();
    if (e3) throw e3;
    txId = tx!.id;

    const { error: e4 } = await supabase.from('payment_line_items').insert([
      { transaction_id: txId, product_id: mainId, item_type: 'main_product', product_name: 'TaxSnap Main', quantity: 1, unit_price: 100, total_price: 100, currency: 'PLN' },
      { transaction_id: txId, product_id: bumpId, item_type: 'order_bump', product_name: 'TaxSnap Bump', quantity: 1, unit_price: 50, total_price: 50, currency: 'PLN' },
    ]);
    if (e4) throw e4;
  });

  afterAll(async () => {
    if (txId) await supabase.from('payment_line_items').delete().eq('transaction_id', txId);
    if (txId) await supabase.from('payment_transactions').delete().eq('id', txId);
    if (mainId || bumpId) await supabase.from('products').delete().in('id', [mainId, bumpId].filter(Boolean));
  });

  it('writes per-line tax + order totals + product vat_exempt when the match is complete', async () => {
    const snapshot: OrderTaxSnapshot = {
      netTotal: 15000,
      taxTotal: 2300,
      currency: 'pln',
      status: 'captured',
      lines: [
        { productId: mainId, isBump: false, netAmount: 10000, taxAmount: 2300, grossAmount: 12300, vatRate: 23, taxBehavior: 'exclusive', taxabilityReason: 'standard_rated', breakdown: [{ amount: 2300, taxableAmount: 10000, rate: 23, effectiveRate: 23, inclusive: false, taxType: 'vat', jurisdiction: 'PL', country: 'PL', state: null, taxabilityReason: 'standard_rated' }] },
        { productId: bumpId, isBump: true, netAmount: 5000, taxAmount: 0, grossAmount: 5000, vatRate: null, taxBehavior: null, taxabilityReason: null, breakdown: [] },
      ],
    };

    const result = await persistTaxSnapshot(supabase, txId, snapshot);
    expect(result.status).toBe('captured');
    expect(result.matched).toBe(2);

    const { data: lines } = await supabase
      .from('payment_line_items')
      .select('product_id, tax_amount, net_amount, vat_rate, vat_exempt, taxability_reason, tax_breakdown')
      .eq('transaction_id', txId);

    const mainLine = lines!.find((l) => l.product_id === mainId)!;
    expect(mainLine.tax_amount).toBe(2300);
    expect(mainLine.net_amount).toBe(10000);
    expect(Number(mainLine.vat_rate)).toBe(23);
    expect(mainLine.vat_exempt).toBe(false);
    expect(mainLine.taxability_reason).toBe('standard_rated');
    expect(Array.isArray(mainLine.tax_breakdown)).toBe(true);
    expect((mainLine.tax_breakdown as unknown[]).length).toBe(1);

    const bumpLine = lines!.find((l) => l.product_id === bumpId)!;
    expect(bumpLine.tax_amount).toBe(0);
    expect(bumpLine.vat_rate).toBeNull();
    expect(bumpLine.vat_exempt).toBe(true); // sourced from products.vat_exempt

    const { data: tx } = await supabase
      .from('payment_transactions')
      .select('net_total, tax_total, tax_snapshot_status')
      .eq('id', txId)
      .single();
    expect(tx!.net_total).toBe(15000);
    expect(tx!.tax_total).toBe(2300);
    expect(tx!.tax_snapshot_status).toBe('captured');
  });

  it('marks the transaction partial without writing per-line tax when lines cannot match', async () => {
    // A snapshot whose single line references an unknown product → cannot match the 2 rows.
    const snapshot: OrderTaxSnapshot = {
      netTotal: 9999,
      taxTotal: 0,
      currency: 'pln',
      status: 'captured',
      lines: [
        { productId: 'unknown-product', isBump: false, netAmount: 9999, taxAmount: 0, grossAmount: 9999, vatRate: null, taxBehavior: null, taxabilityReason: null, breakdown: [] },
      ],
    };

    const result = await persistTaxSnapshot(supabase, txId, snapshot);
    expect(result.status).toBe('partial');
    expect(result.matched).toBe(0);

    const { data: tx } = await supabase
      .from('payment_transactions')
      .select('tax_snapshot_status')
      .eq('id', txId)
      .single();
    expect(tx!.tax_snapshot_status).toBe('partial');
  });
});
