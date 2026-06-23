import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { persistTaxSnapshot, captureAndPersistOrderTax, type OrderTaxSnapshot } from '@/lib/services/tax-snapshot';
import type { Database } from '@/types/database';
import type Stripe from 'stripe';

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
      stripeTaxApplied: false,
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

  it('Stripe Tax mode → vat_exempt forced false (Stripe authoritative, NOT the product flag)', async () => {
    // bumpId has products.vat_exempt = true, but this order was computed by Stripe Tax,
    // so the line must NOT inherit the PL "zw." flag — taxability is Stripe's call and the
    // truth lives in taxability_reason. (Prevents claiming exemption where Stripe charged VAT.)
    const snapshot: OrderTaxSnapshot = {
      netTotal: 15000,
      taxTotal: 2300,
      currency: 'pln',
      status: 'captured',
      stripeTaxApplied: true,
      lines: [
        { productId: mainId, isBump: false, netAmount: 10000, taxAmount: 2300, grossAmount: 12300, vatRate: 23, taxBehavior: 'exclusive', taxabilityReason: 'standard_rated', breakdown: [] },
        { productId: bumpId, isBump: true, netAmount: 5000, taxAmount: 0, grossAmount: 5000, vatRate: null, taxBehavior: null, taxabilityReason: 'customer_exempt', breakdown: [] },
      ],
    };

    const result = await persistTaxSnapshot(supabase, txId, snapshot);
    expect(result.status).toBe('captured');
    expect(result.matched).toBe(2);

    const { data: lines } = await supabase
      .from('payment_line_items')
      .select('product_id, vat_exempt, taxability_reason')
      .eq('transaction_id', txId);

    // products.vat_exempt(bumpId) = true, but Stripe Tax mode forces every line false.
    for (const l of lines!) expect(l.vat_exempt).toBe(false);
    const bumpLine = lines!.find((l) => l.product_id === bumpId)!;
    expect(bumpLine.taxability_reason).toBe('customer_exempt');
  });

  it('marks the transaction partial without writing per-line tax when lines cannot match', async () => {
    // A snapshot whose single line references an unknown product → cannot match the 2 rows.
    const snapshot: OrderTaxSnapshot = {
      netTotal: 9999,
      taxTotal: 0,
      currency: 'pln',
      status: 'captured',
      stripeTaxApplied: false,
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

  it('rejects an out-of-domain tax_behavior at the DB (CHECK constraint guards our derived value)', async () => {
    // tax_behavior is OUR derived enum ('inclusive'|'exclusive'|null), never Stripe's raw
    // 'unspecified'. The CHECK must reject anything else so a future code/migration drift
    // that writes garbage fails loudly instead of silently corrupting the snapshot.
    // 'unspecified' is type-valid (column is text) but out of our domain — only the DB
    // CHECK stops it. That's exactly the safety net under test.
    const { error } = await supabase
      .from('payment_line_items')
      .update({ tax_behavior: 'unspecified' })
      .eq('transaction_id', txId)
      .eq('product_id', mainId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/payment_line_items_tax_behavior_chk|check constraint/i);
  });

  it('captureAndPersistOrderTax (happy path): fetches Stripe lines → builds → persists a captured snapshot to the real DB', async () => {
    // Every other DB-touching capture test exercises a fail-safe/error branch; this is the
    // SUCCESS orchestration: a realistic Stripe Checkout Session (23% exclusive main + exempt
    // bump) → captureCheckoutSessionTax → persistTaxSnapshot writes the real rows.
    const fakeStripe = {
      checkout: {
        sessions: {
          listLineItems: async () => ({
            data: [
              {
                id: 'li_main', amount_subtotal: 10000, amount_tax: 2300, amount_total: 12300, currency: 'pln',
                price: { product: { metadata: { product_id: mainId } } },
                taxes: [{
                  amount: 2300, taxable_amount: 10000, taxability_reason: 'standard_rated',
                  rate: { percentage: 23, effective_percentage: 23, inclusive: false, tax_type: 'vat', jurisdiction: 'PL', country: 'PL', state: null },
                }],
              },
              {
                id: 'li_bump', amount_subtotal: 5000, amount_tax: 0, amount_total: 5000, currency: 'pln',
                price: { product: { metadata: { product_id: bumpId, is_bump: 'true' } } },
                taxes: [],
              },
            ],
          }),
          retrieve: async () => ({
            amount_subtotal: 15000,
            total_details: { amount_tax: 2300 },
            currency: 'pln',
            automatic_tax: { enabled: false },
          }),
        },
      },
    } as unknown as Stripe;

    const snapshot = await captureAndPersistOrderTax({
      stripe: fakeStripe,
      supabase,
      transactionId: txId,
      sessionId: `cs_taxsnap_${suffix}`,
    });

    expect(snapshot?.status).toBe('captured');
    expect(snapshot?.netTotal).toBe(15000);
    expect(snapshot?.taxTotal).toBe(2300);

    const { data: lines } = await supabase
      .from('payment_line_items')
      .select('product_id, tax_amount, net_amount, vat_rate, tax_behavior, taxability_reason')
      .eq('transaction_id', txId);
    const mainLine = lines!.find((l) => l.product_id === mainId)!;
    expect(mainLine.tax_amount).toBe(2300);
    expect(mainLine.net_amount).toBe(10000);
    expect(Number(mainLine.vat_rate)).toBe(23);
    expect(mainLine.tax_behavior).toBe('exclusive');
    expect(mainLine.taxability_reason).toBe('standard_rated');
    const bumpLine = lines!.find((l) => l.product_id === bumpId)!;
    expect(bumpLine.tax_amount).toBe(0);

    const { data: tx } = await supabase
      .from('payment_transactions')
      .select('net_total, tax_total, tax_snapshot_status')
      .eq('id', txId)
      .single();
    expect(tx!.net_total).toBe(15000);
    expect(tx!.tax_total).toBe(2300);
    expect(tx!.tax_snapshot_status).toBe('captured');
  });
});
