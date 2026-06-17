import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Regression: process_stripe_payment_completion_with_bump used product.price as
// the expected amount and (with no coupon) rejected anything != full price, so a
// purchase charged at the active sale price was rejected as "Amount mismatch".
// The completion validator must accept the sale price when a sale is active.
describe('process_stripe_payment_completion_with_bump — active sale price', () => {
  const TS = Date.now();
  let productId: string;

  beforeAll(async () => {
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        slug: `sale-charge-${TS}`,
        name: 'Sale Charge Product',
        price: 499,
        sale_price: 349,
        sale_price_until: null,
        currency: 'pln',
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    productId = product!.id;
  });

  const complete = (suffix: string, amountCents: number) =>
    supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: `cs_sale_${TS}_${suffix}`,
      product_id_param: productId,
      customer_email_param: `sale.${TS}.${suffix}@example.com`,
      amount_total: amountCents,
      currency_param: 'pln',
      stripe_payment_intent_id: `pi_sale_${TS}_${suffix}`,
    });

  it('accepts a purchase charged at the active sale price (349, no coupon)', async () => {
    const { data } = await complete('sale', 34900);
    expect((data as any)?.success).toBe(true);
  });

  it('still accepts the full price (overpay up to regular price is harmless)', async () => {
    const { data } = await complete('full', 49900);
    expect((data as any)?.success).toBe(true);
  });

  it('rejects an amount below the active sale price', async () => {
    const { data, error } = await complete('toolow', 30000);
    // RAISE EXCEPTION surfaces either as an error or as a handled {success:false}
    const failed = error != null || (data as any)?.success === false;
    expect(failed).toBe(true);
  });

  it('records the sale price as the main line-item price', async () => {
    const { data } = await complete('lineitem', 34900);
    expect((data as any)?.success).toBe(true);

    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', `cs_sale_${TS}_lineitem`)
      .single();

    const { data: li } = await supabaseAdmin
      .from('payment_line_items')
      .select('unit_price')
      .eq('transaction_id', tx!.id)
      .eq('item_type', 'main_product')
      .single();

    expect(Number(li!.unit_price)).toBe(349);
  });
});
