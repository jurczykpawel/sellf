import { resetAffiliateDatabase } from '../database';
/** Product settings integration on the disposable stack. @see actions.test.ts */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'dddddddd-0000-4000-a000-000000000000', email: 'admin@example.test' } } }) },
  from: (table: string) => (state.client as ReturnType<typeof createClient>).from(table),
}) }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
import { bindAffiliateCoupon, createAffiliateRule, getAffiliateCoupon, getAffiliateProduct } from '@/lib/affiliates/products/actions';
import { DELETE, PATCH } from '@/app/api/v1/products/[id]/route';
function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_sellf-aff-a18', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
const member = 'af000000-0000-4000-a000-000000000001';
const coupon = 'af000000-0000-4000-a000-000000000005';
const seededProduct = 'af000000-0000-4000-a000-000000000002';
function product(): string {
  const id = randomUUID(); sql(`INSERT INTO products(id,name,slug,price,currency,is_active) VALUES('${id}','Product settings','${id}',123,'PLN',true)`); return id;
}
const input = (id: string, revision = 0) => ({ product_id: id, expected_revision: revision, enabled: true, rule: { percentage_bps: 2000 } });
beforeAll(() => {
  resetAffiliateDatabase();
  const env = JSON.parse(execFileSync('npx', ['supabase', 'status', '--workdir', '/private/tmp/sellf-aff-a18', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  expect(env.API_URL).toBe('http://127.0.0.1:55471');
  state.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
});
it('creates immutable revisions, preserves exact fixed amounts and checks expected revision', async () => {
  const client = state.client as ReturnType<typeof createClient>;
  const id = product(); expect(await createAffiliateRule(input(id))).toMatchObject({ success: true });
  expect(await createAffiliateRule(input(id))).toMatchObject({ success: false, errorCode: 'CONFLICT' });
  const stale = await client.rpc('affiliate_rule_create', { p_actor: 'dddddddd-0000-4000-a000-000000000000', p_product: id, p_expected_revision: 0, p_enabled: true, p_percentage_bps: 2000, p_fixed_minor: null, p_currency: null });
  expect(stale.status).toBe(409); expect(stale.error?.code).toBe('PT409');
  expect(await createAffiliateRule({ ...input(id, 1), enabled: false, rule: { fixed_minor: '9007199254740993', currency: 'PLN' } })).toMatchObject({ success: true });
  expect(await getAffiliateProduct(id)).toMatchObject({ success: true, data: { rule: { revision: 2, enabled: false, fixed_minor: '9007199254740993' } } });
  expect(sql(`SELECT count(*) FROM affiliate_rules WHERE product_id='${id}'`)).toBe('2');
  expect((await client.from('affiliate_rules').update({ enabled: false }).eq('product_id', id)).error).toBeTruthy();
});
it('keeps bindings historical and denies pending owners and stale versions', async () => {
  const pending = randomUUID();
  sql(`INSERT INTO affiliate_memberships(id,code,display_name,status,accepted_terms_version,accepted_at) VALUES('${pending}','${pending}','Pending','pending','demo-v1',now())`);
  const before = await getAffiliateCoupon({ coupon_id: coupon }); expect(before.success).toBe(true);
  const version = before.data!.binding!.version;
  expect(await bindAffiliateCoupon({ coupon_id: coupon, member_id: pending, expected_version: version })).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
  expect(await bindAffiliateCoupon({ coupon_id: coupon, member_id: member, expected_version: version })).toMatchObject({ success: true });
  expect(await bindAffiliateCoupon({ coupon_id: coupon, member_id: member, expected_version: version })).toMatchObject({ success: false, errorCode: 'CONFLICT' });
  const stale = await (state.client as ReturnType<typeof createClient>).rpc('affiliate_coupon_bind', { p_actor: 'dddddddd-0000-4000-a000-000000000000', p_coupon: coupon, p_member: member, p_expected_version: version });
  expect(stale.status).toBe(409); expect(stale.error?.code).toBe('PT409');
  expect(sql(`SELECT count(*) FROM affiliate_coupon_bindings WHERE coupon_id='${coupon}' AND retired_at IS NOT NULL`)).not.toBe('0');
  expect((await getAffiliateCoupon({ coupon_id: coupon })).data?.members.some(m => m.id === pending)).toBe(false);
});
it('retains categories and financial history on DELETE and archives products with and without sales', async () => {
  for (const id of [product(), seededProduct]) {
    if (id !== seededProduct) await createAffiliateRule(input(id));
    const category = sql('SELECT id FROM categories LIMIT 1');
    sql(`INSERT INTO product_categories(product_id,category_id) VALUES('${id}','${category}') ON CONFLICT DO NOTHING`);
    const counts = sql(`SELECT (SELECT count(*) FROM payment_transactions WHERE product_id='${id}'),(SELECT count(*) FROM affiliate_rules WHERE product_id='${id}')`);
    const params = { params: Promise.resolve({ id }) };
    const url = `http://localhost/api/v1/products/${id}`;
    const denied = await DELETE(new NextRequest(url, { method: 'DELETE' }), params);
    expect(denied.status).toBe(409); expect(JSON.stringify(await denied.json())).toContain('is_active');
    expect(sql(`SELECT count(*) FROM product_categories WHERE product_id='${id}'`)).toBe('1');
    const archived = await PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify({ is_active: false }), headers: { 'Content-Type': 'application/json' } }), params);
    expect(archived.status).toBe(200);
    expect(sql(`SELECT is_active FROM products WHERE id='${id}'`)).toBe('f');
    expect(sql(`SELECT (SELECT count(*) FROM payment_transactions WHERE product_id='${id}'),(SELECT count(*) FROM affiliate_rules WHERE product_id='${id}')`)).toBe(counts);
  }
});
it('rejects subscription rules and exposes the unlimited refund policy', async () => {
  const id = sql("SELECT id FROM products WHERE product_type='subscription' LIMIT 1");
  expect(id).not.toBe(''); expect(await createAffiliateRule(input(id))).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
  expect(await getAffiliateProduct('af000000-0000-4000-a000-000000000004')).toMatchObject({ success: true, data: { product: { is_refundable: true, refund_period_days: null } } });
});
