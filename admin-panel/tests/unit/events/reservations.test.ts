/** Event inventory acceptance through the same service RPC used by checkout. */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
let product: string; let session: string; let cheap: string; let regular: string;
const future = '2099-06-01T12:00:00Z';
const past = '2000-01-01T00:00:00Z';
async function checked<T>(r: { data: T; error: unknown }): Promise<NonNullable<T>> {
  if (r.error) throw r.error; return r.data!;
}
async function availability(at = '2099-05-01T12:00:00Z') {
  return (await checked(await db.rpc('event_availability', { p_product_id: product, p_at: at })))[0];
}
async function place(overrides: Record<string, unknown> = {}, quantity = 1, price = 47) {
  return db.rpc('place_order', {
    p_order: { product_id: product, currency: 'PLN', customer_email: `${crypto.randomUUID()}@example.com`,
      session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}`, metadata: { event_ip: crypto.randomUUID() }, ...overrides },
    p_lines: [{ product_id: product, item_type: 'main_product', quantity, unit_price: price,
      total_price: price * quantity, discounted_total: price * quantity, currency: 'PLN', product_name: 'Workshop', session_id: session }],
  });
}
async function clear() { await checked(await db.from('payment_transactions').delete().eq('product_id', product)); }
beforeAll(async () => {
  product = (await checked(await db.from('products').insert({ name: 'Workshop', slug: `event-${crypto.randomUUID()}`, price: 67, currency: 'PLN', event_mode: true }).select('id').single())).id;
  session = (await checked(await db.from('product_sessions').insert({ product_id: product, starts_at: future, capacity: 5, title: 'June edition', online_url: 'https://example.com/private' }).select('id').single())).id;
  const tiers = await checked(await db.from('product_price_tiers').insert([
    { session_id: session, label: 'Early', price: 47, seats: 3, sort: 0, sale_ends_at: '2099-05-15T12:00:00Z' },
    { session_id: session, label: 'Regular', price: 67, sort: 1 },
  ]).select('id,sort'));
  cheap = tiers.find(t => t.sort === 0)!.id; regular = tiers.find(t => t.sort === 1)!.id;
});
afterAll(async () => {
  if (product) { await clear(); await db.from('product_sessions').delete().eq('product_id', product); await db.from('products').delete().eq('id', product); }
});
describe('event availability and reservations', () => {
  it('selects lowest price, next price, and fixed time boundaries', async () => {
    expect(await availability()).toMatchObject({ remaining: 5, sold_out: false, cheaper_sold_out: false, next_tier_price: 67,
      current_tier: { id: cheap, price: 47, seats_left: 3 } });
    expect(await availability('2099-05-15T12:00:00Z')).toMatchObject({ current_tier: { id: regular, price: 67 }, cheaper_sold_out: true, next_tier_price: null });
    expect((await availability(future)).current_tier).toBeNull();
    await checked(await db.from('product_sessions').update({ sales_open: false }).eq('id', session));
    expect((await availability()).current_tier).toBeNull();
    await checked(await db.from('product_sessions').update({ sales_open: true }).eq('id', session));
  });
  it('does not accept a client price', async () => {
    expect((await place({}, 1, 1)).error?.message).toBe('event_price_changed');
    expect(await checked(await db.from('seat_reservations').select('id').eq('session_id', session))).toHaveLength(0);
  });
  it('stores the session snapshot and a thirty-minute hold', async () => {
    const r = await checked(await place());
    const row = await checked(await db.from('seat_reservations').select('*').eq('transaction_id', r.transaction_id).single());
    expect(row).toMatchObject({ status: 'held', tier_id: cheap, quantity: 1 });
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(30 * 60 * 1000);
    expect(await checked(await db.from('payment_line_items').select('session_id,tier_id,session_label,session_starts_at').eq('transaction_id', r.transaction_id).single()))
      .toMatchObject({ session_id: session, tier_id: cheap, session_label: 'June edition', session_starts_at: '2099-06-01T12:00:00+00:00' });
    await clear();
  });
  it('moves to regular pricing when early seats are held, and ignores expired holds', async () => {
    const r = await checked(await place({}, 3));
    expect(await availability(new Date().toISOString())).toMatchObject({ current_tier: { id: regular }, remaining: 2, cheaper_sold_out: true });
    await checked(await db.from('seat_reservations').update({ expires_at: past }).eq('transaction_id', r.transaction_id));
    expect((await availability()).current_tier.id).toBe(cheap);
    expect(await checked(await db.rpc('expire_seat_reservations'))).toBeGreaterThanOrEqual(1);
    expect((await checked(await db.from('seat_reservations').select('status').eq('transaction_id', r.transaction_id).single())).status).toBe('released');
    await clear();
  });
  it('admits exactly five of twenty concurrent orders with five seats', async () => {
    await checked(await db.from('product_price_tiers').update({ seats: null }).eq('id', cheap));
    const results = await Promise.all(Array.from({ length: 20 }, () => place()));
    expect(results.filter(r => !r.error)).toHaveLength(5);
    expect(results.filter(r => r.error?.message === 'sold_out')).toHaveLength(15);
    expect(await checked(await db.from('seat_reservations').select('id').eq('session_id', session).eq('status', 'held'))).toHaveLength(5);
    expect(await availability(new Date().toISOString())).toMatchObject({ remaining: 0, sold_out: true, current_tier: null });
    await clear();
  });
  it('confirms once and releases on a full refund, abandonment and transfer cancellation', async () => {
    const r = await checked(await place());
    for (let i=0;i<2;i++) await checked(await db.rpc('confirm_event_order', { p_transaction_id: r.transaction_id }));
    expect((await checked(await db.from('seat_reservations').select('status').eq('transaction_id', r.transaction_id).single())).status).toBe('confirmed');
    for (const status of ['refunded', 'abandoned', 'cancelled']) {
      await checked(await db.from('payment_transactions').update({ status }).eq('id', r.transaction_id));
      expect((await checked(await db.from('seat_reservations').select('status').eq('transaction_id', r.transaction_id).single())).status).toBe('released');
    }
    await clear();
  });
  it('reacquires a released hold when seats remain', async () => {
    const r = await checked(await place());
    await checked(await db.from('seat_reservations').update({ status: 'released' }).eq('transaction_id', r.transaction_id));
    await checked(await db.rpc('confirm_event_order', { p_transaction_id: r.transaction_id }));
    expect((await checked(await db.from('seat_reservations').select('status').eq('transaction_id', r.transaction_id).single())).status).toBe('confirmed');
    await clear();
  });
  it('recreates a missing reservation from the persisted snapshot', async () => {
    const r = await checked(await place());
    await checked(await db.from('seat_reservations').delete().eq('transaction_id', r.transaction_id));
    await checked(await db.rpc('confirm_event_order', { p_transaction_id: r.transaction_id }));
    expect((await checked(await db.from('seat_reservations').select('status').eq('transaction_id', r.transaction_id).single())).status).toBe('confirmed');
    expect((await availability()).remaining).toBe(4);
    await clear();
  });
  it('records oversold on late completion without discarding the payment', async () => {
    const late = await checked(await place());
    await checked(await db.from('seat_reservations').update({ status: 'released' }).eq('transaction_id', late.transaction_id));
    await checked(await place({}, 5));
    await checked(await db.rpc('_order_grant_and_record', { p_transaction_id: late.transaction_id, p_user_id: null,
      p_existing_user_id: null, p_requested_user_id: null, p_coupon_id: null, p_coupon_mode: 'none' }));
    expect((await checked(await db.from('payment_transactions').select('metadata').eq('id', late.transaction_id).single())).metadata.oversold).toBe(true);
    expect(await checked(await db.from('guest_purchases').select('id').eq('transaction_id', late.transaction_id))).toHaveLength(1);
    expect(await checked(await db.from('audit_log').select('id').contains('new_values', { action: 'event.oversold', transaction_id: late.transaction_id }))).toHaveLength(1);
    await clear();
  });
  it('enforces three email holds and five IP holds, with release allowing replacement', async () => {
    await checked(await db.from('product_sessions').update({ capacity: null }).eq('id', session));
    const email = `${crypto.randomUUID()}@example.com`;
    const held = await Promise.all(Array.from({ length: 4 }, () => place({ customer_email: email })));
    expect(held.filter(r => !r.error)).toHaveLength(3);
    expect(held.find(r => r.error)?.error?.message).toBe('event_hold_limit');
    await checked(await db.from('payment_transactions').update({ status: 'abandoned' }).eq('id', held.find(r => !r.error)!.data.transaction_id));
    expect((await place({ customer_email: email })).error).toBeNull();
    await clear();
    const results = await Promise.all(Array.from({ length: 6 }, () => place({ metadata: { event_ip: '192.0.2.1' } })));
    expect(results.filter(r => !r.error)).toHaveLength(5);
    expect(results.find(r => r.error)?.error?.message).toBe('event_hold_limit');
    await clear();
  });
  it('handles unlimited inventory and price ties by sort', async () => {
    await checked(await db.from('product_price_tiers').update({ price: 47 }).eq('id', regular));
    expect(await availability()).toMatchObject({ remaining: null, current_tier: { id: cheap, seats_left: null } });
  });
  it('restricts internal data and provides only the public projection', async () => {
    expect((await anon.from('product_sessions').select('online_url')).error).not.toBeNull();
    expect((await anon.from('seat_reservations').select('*')).error).not.toBeNull();
    expect((await anon.rpc('event_availability', { p_product_id: product })).error?.code).toBe('42501');
    const projection = await checked(await db.rpc('public_event_availability', { p_product_id: product }));
    expect(JSON.stringify(projection)).not.toContain('online_url');
    expect(JSON.stringify(projection)).not.toContain('customer_email');
    const sql = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bbbbbbbb-0000-4000-a000-000000000000"}',true); DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM public.product_sessions); ASSERT NOT EXISTS (SELECT 1 FROM public.seat_reservations); END $$; ROLLBACK;`;
    expect(() => execFileSync('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe','pipe','pipe'] })).not.toThrow();
  });
});
