/** Twenty simultaneous reservation jobs and declarations on one order produce exactly one release and one extension. */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let config: Database['public']['Tables']['bank_transfer_config']['Row'];
let productId: string, sessionId: string;
beforeAll(async () => {
  config = (await db.from('bank_transfer_config').select('*').single()).data!;
  await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Concurrency shop', bank_account_number: 'PL61109010140000071219812874', bank_transfer_max_unpaid_per_email: 100 }).eq('id', true);
  productId = (await db.from('products').insert({ name: 'Concurrency workshop', slug: `unpaid-race-${randomUUID()}`, price: 50, currency: 'PLN', event_mode: true,
    checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] }] } }).select('id').single()).data!.id;
  sessionId = (await db.from('product_sessions').insert({ product_id: productId, starts_at: '2099-01-01T10:00:00Z', capacity: 50 }).select('id').single()).data!.id;
  await db.from('product_price_tiers').insert({ session_id: sessionId, price: 50, sort: 0 });
});
afterAll(async () => {
  await db.from('payment_transactions').delete().eq('product_id', productId);
  await db.from('products').delete().eq('id', productId);
  await db.from('bank_transfer_config').update(config).eq('id', true);
});
async function place(): Promise<string> {
  const { data, error } = await db.rpc('bank_transfer_order', {
    p_order: { product_id: productId, currency: 'PLN', customer_email: `race-${randomUUID()}@example.com`, order_details: { v: 1, buyer: { type: 'organization', terms_accepted: true } } },
    p_lines: [{ product_id: productId, item_type: 'main_product', quantity: 1, unit_price: 50, total_price: 50, discounted_total: 50, currency: 'PLN', session_id: sessionId }],
  });
  if (error) throw error;
  return (data as { transaction_id: string }).transaction_id;
}
it('releases an expired order exactly once under concurrent jobs', async () => {
  const id = await place();
  const later = new Date(Date.now() + 49 * 3600000).toISOString();
  const results = await Promise.all(Array.from({ length: 20 }, () => db.rpc('release_unpaid_transfer', { p_id: id, p_now: later })));
  expect(results.every(r => !r.error)).toBe(true);
  expect(results.filter(r => (r.data as { released: boolean }).released)).toHaveLength(1);
  const audit = await db.from('audit_log').select('id').eq('new_values->>action', 'order.released').eq('new_values->>transaction_id', id);
  expect(audit.data).toHaveLength(1);
});
it('extends a reservation exactly once under concurrent declarations', async () => {
  const id = await place();
  const now = new Date().toISOString();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => db.rpc('declare_transfer', { p_id: id, p_note: `click ${i}`, p_now: now })));
  expect(results.filter(r => (r.data as { already_declared: boolean }).already_declared === false)).toHaveLength(1);
  const { data } = await db.from('payment_transactions').select('release_at,transfer_declared_at').eq('id', id).single();
  expect(Date.parse(data!.release_at!)).toBe(Date.parse(now) + 72 * 3600000);
});
