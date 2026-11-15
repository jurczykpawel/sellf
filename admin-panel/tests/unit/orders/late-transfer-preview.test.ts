/** What the administrator sees before accepting a transfer that arrived after cancellation (W254, D6): the order price
 * against today's price, the seats left, the coupon state and the corrected-invoice block. Nothing is changed. */
import { describe, expect, it, vi } from 'vitest';
import { previewLateTransfer } from '@/lib/orders/late-transfer-preview';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const id = '10000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-02-02T12:00:00Z');
const tx = { id, payment_provider: 'bank_transfer', status: 'cancelled', amount: 8000, currency: 'PLN', product_id: 'p1', coupon_id: null as string | null };
const line = { product_id: 'p1', item_type: 'main_product', quantity: 1, unit_price: 80, session_id: 's1' };
const product = { id: 'p1', is_active: true, price: 80, sale_price: null, sale_price_until: null, sale_quantity_limit: null, sale_quantity_sold: 0 };
const session = (extra: Record<string, unknown> = {}) => [{ id: 's1', starts_at: '2099-01-01T00:00:00Z', remaining: 3, sold_out: false, current_tier: { price: 80 }, ...extra }];

function db(tables: Record<string, unknown>, availability: unknown = session()) {
  const writes: string[] = [];
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? null, error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) q[m] = () => q;
    for (const m of ['update', 'insert', 'delete', 'upsert']) q[m] = () => { writes.push(table); return q; };
    q.single = async () => ({ ...result, data: Array.isArray(result.data) ? result.data[0] : result.data });
    q.maybeSingle = q.single;
    q.then = (resolve: (v: unknown) => void) => resolve(result);
    return q;
  });
  const rpc = vi.fn(async () => ({ data: availability, error: null }));
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, writes, rpc };
}
const base = { payment_transactions: tx, payment_line_items: [line], products: product, invoices: null };

describe('late transfer preview', () => {
  it('same price, free seat, no coupon: acceptance takes a normal seat', async () => {
    const { client, writes } = db(base);
    expect(await previewLateTransfer(client, id, NOW)).toEqual({ amount: 8000, currency: 'PLN', unitPrice: 80, unitPriceToday: 80, priceChanged: false,
      seats: { remaining: 3, quantity: 1, oversold: false, started: false }, coupon: null, invoiceCorrected: false });
    expect(writes).toEqual([]);
  });
  it('promo sold out at a higher tier: the order price is honoured, the seat goes over the limit', async () => {
    const { client } = db(base, session({ remaining: 0, sold_out: true, current_tier: { price: 120 } }));
    expect(await previewLateTransfer(client, id, NOW)).toMatchObject({ unitPriceToday: 120, priceChanged: true, seats: { remaining: 0, oversold: true } });
  });
  it('coupon exhausted or expired after release is shown, not blocking', async () => {
    const coupon = { code: 'JESIEN', is_active: true, usage_limit_global: 1, current_usage_count: 1, expires_at: null };
    const { client } = db({ ...base, payment_transactions: { ...tx, coupon_id: 'c1' }, coupons: coupon });
    expect((await previewLateTransfer(client, id, NOW))?.coupon).toEqual({ code: 'JESIEN', status: 'exhausted' });
    const { client: expired } = db({ ...base, payment_transactions: { ...tx, coupon_id: 'c1' }, coupons: { ...coupon, current_usage_count: 0, expires_at: '2026-01-01T00:00:00Z' } });
    expect((await previewLateTransfer(expired, id, NOW))?.coupon).toEqual({ code: 'JESIEN', status: 'expired' });
  });
  it('regular product compares with its current effective price; a corrected invoice is flagged', async () => {
    const { client } = db({ ...base, payment_line_items: [{ ...line, session_id: null }], products: { ...product, price: 100 }, invoices: { status: 'corrected' } });
    expect(await previewLateTransfer(client, id, NOW)).toMatchObject({ unitPriceToday: 100, priceChanged: true, seats: null, invoiceCorrected: true });
  });
  it('only a cancelled transfer order has a preview', async () => {
    const { client } = db({ ...base, payment_transactions: { ...tx, status: 'awaiting_payment' } });
    expect(await previewLateTransfer(client, id, NOW)).toBeNull();
  });
});
