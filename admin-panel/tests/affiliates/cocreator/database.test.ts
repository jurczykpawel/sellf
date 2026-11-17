/** Co-creator commission against the disposable stack: accrual, sum with partner, refunds, payout gate. @see lib/affiliates/cocreator/service.ts */
import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
import { getAffiliateTestConfig, resetAffiliateDatabase } from '../database';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ client: undefined as unknown, sessionCreated: 0 }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }));
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: async () => false }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ user: { id: admin }, dataClient: state.client }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(),
  authenticate: async () => ({ method: 'session', supabase: state.client, admin: { userId: admin, adminId: 'adm', email: 'demo@sellf.app' }, scopes: ['products:read', 'products:write'] }) }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: async () => ({ checkout: { sessions: {
  list: async () => ({ data: [], has_more: false }),
  retrieve: async (id: string) => ({ id, created: state.sessionCreated || Math.floor(Date.now() / 1000), livemode: false }),
} } }) }));
import { drainAffiliateWork } from '@/lib/affiliates/sync/worker';
import { previewPayout } from '@/lib/affiliates/payouts/reads';
import { cancelPayout, markPayoutPaid, reservePayout } from '@/lib/affiliates/payouts/actions';
import { downloadPayoutCsv } from '@/lib/affiliates/payouts/download';
import { publishCreatorTerms, removeProductCocreator, setProductCocreator } from '@/lib/affiliates/cocreator/actions';
import { DELETE, GET, PUT } from '@/app/api/v1/products/[id]/cocreator/route';
import { DELETE as DELETE_PRODUCT } from '@/app/api/v1/products/[id]/route';
import { NextRequest } from 'next/server';
import { cocreatorResponseSchema } from '@/lib/affiliates/cocreator/model';

const admin = 'dddddddd-0000-4000-a000-000000000000';
const partnerMember = 'af000000-0000-4000-a000-000000000001';
const partnerEmail = 'buyer@demo.sellf.app';
const creatorEmail = 'anna.kowalska@example.com';
const creatorUser = 'cccccccc-3333-4333-a333-333333333333';
const coupon = 'af000000-0000-4000-a000-000000000005';
const partnerUser = 'bbbbbbbb-0000-4000-a000-000000000000';
const products = { split: randomUUID(), same: randomUUID(), fixed: randomUUID(), later: randomUUID(), sub: randomUUID(), api: randomUUID(),
  referralOnly: randomUUID(), partnerCreated: randomUUID() };

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
const asService = `SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);`;
function payment(product: string, options: { coupon?: boolean; sessionCreated?: number } = {}): string {
  const id = randomUUID();
  sql(`INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id,fulfillment_pending)
    VALUES('${id}','${product}','creator-buyer-${id}@example.test',12300,'PLN','completed','cs_test_${id.replaceAll('-', '')}',false);
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,net_amount)
    VALUES('${id}','${product}','main_product',1,123,123,'PLN',10000);
    ${options.coupon ? `INSERT INTO public.coupon_redemptions(coupon_id,transaction_id,customer_email,discount_amount) VALUES('${coupon}','${id}','creator-buyer-${id}@example.test',10);` : ''}`);
  return id;
}
async function drain(sessionCreated = 0): Promise<void> {
  state.sessionCreated = sessionCreated;
  expect(await drainAffiliateWork(100)).toMatchObject({ success: true, data: { failed: 0 } });
}
function earned(id: string, kind: 'referral' | 'cocreator'): string {
  return sql(`SELECT coalesce(sum(l.amount_minor),0)::text FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
    WHERE c.payment_id='${id}' AND c.kind='${kind}'`);
}
function memberOf(user: string): string { return sql(`SELECT id FROM public.affiliate_memberships WHERE user_id='${user}'`); }
async function assign(product: string, email: string, rule: Record<string, unknown>): Promise<void> {
  const revision = Number(sql(`SELECT coalesce(max(revision),0) FROM public.affiliate_cocreator_rules WHERE product_id='${product}'`));
  const result = await setProductCocreator({ product_id: product, expected_revision: revision, email, rule });
  expect(result).toMatchObject({ success: true });
}

beforeAll(async () => {
  resetAffiliateDatabase();
  const env = getAffiliateTestConfig();
  state.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  sql(`INSERT INTO public.products(id,name,slug,price,currency,is_active,is_refundable) VALUES
    ('${products.split}','Creator Split Course','creator-split-${products.split}',123,'PLN',true,false),
    ('${products.same}','Creator Same Person Course','creator-same-${products.same}',123,'PLN',true,false),
    ('${products.fixed}','Creator Fixed Course','creator-fixed-${products.fixed}',123,'PLN',true,false),
    ('${products.later}','Creator Later Course','creator-later-${products.later}',123,'PLN',true,false),
    ('${products.api}','Creator API Course','creator-api-${products.api}',123,'PLN',true,false),
    ('${products.referralOnly}','Partner Only Course','partner-only-${products.referralOnly}',123,'PLN',true,false),
    ('${products.partnerCreated}','Partner Co-created Course','partner-created-${products.partnerCreated}',123,'PLN',true,false);
    INSERT INTO public.products(id,name,slug,price,currency,is_active,product_type,billing_interval,billing_interval_count,recurring_price)
    VALUES('${products.sub}','Creator Subscription','creator-sub-${products.sub}',10,'PLN',true,'subscription','month',1,10);
    ${asService}
    SELECT public.affiliate_program_update('${admin}',version,enabled,terms_version,terms,0,0,thresholds) FROM public.affiliate_programs;
    SELECT public.affiliate_rule_create('${admin}','${products.split}',0,true,2000,NULL,NULL);
    SELECT public.affiliate_rule_create('${admin}','${products.same}',0,true,2000,NULL,NULL);
    SELECT public.affiliate_rule_create('${admin}','${products.referralOnly}',0,true,2000,NULL,NULL);`);
  await assign(products.split, creatorEmail, { percentage_bps: 1000 });
  await assign(products.same, partnerEmail, { percentage_bps: 1000 });
  await assign(products.fixed, creatorEmail, { fixed_minor: '1500', currency: 'PLN' });
  // Sessions carry whole seconds; start them after the rules exist.
  await new Promise(resolve => setTimeout(resolve, 1100));
}, 180000);

describe('co-creator commission', () => {
  it('adds the co-creator share to the partner share on one line (20% + 10%) @J640', async () => {
    const id = payment(products.split, { coupon: true }); await drain();
    expect(earned(id, 'referral')).toBe('2000');
    expect(earned(id, 'cocreator')).toBe('1000');
    expect(sql(`SELECT member_id FROM public.affiliate_commissions WHERE payment_id='${id}' AND kind='cocreator'`)).toBe(memberOf(creatorUser));
  });
  it('pays one person both shares when the partner is also the co-creator (20% + 10% = 30%)', async () => {
    const id = payment(products.same, { coupon: true }); await drain();
    expect(sql(`SELECT count(*)::text||':'||sum(l.amount_minor)::text FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
      WHERE c.payment_id='${id}' AND c.member_id='${partnerMember}'`)).toBe('2:3000');
  });
  it('accrues a fixed amount without any coupon, once per line', async () => {
    const id = payment(products.fixed); await drain(); await drain();
    expect(earned(id, 'cocreator')).toBe('1500');
    expect(earned(id, 'referral')).toBe('0');
    sql(`UPDATE public.payment_transactions SET refunded_amount=0 WHERE id='${id}'`); await drain();
    expect(sql(`SELECT count(*) FROM public.affiliate_commissions WHERE payment_id='${id}'`)).toBe('1');
  });
  it('rejects a co-creator on a subscription product', async () => {
    const result = await setProductCocreator({ product_id: products.sub, expected_revision: 0, email: creatorEmail, rule: { percentage_bps: 1000 } });
    expect(result).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
    expect(sql(`SELECT count(*) FROM public.affiliate_cocreator_rules WHERE product_id='${products.sub}'`)).toBe('0');
  });
  it('rejects a person without an account', async () => {
    const result = await setProductCocreator({ product_id: products.later, expected_revision: 0, email: 'nobody-here@example.test', rule: { percentage_bps: 1000 } });
    expect(result).toMatchObject({ success: false, errorCode: 'ACCOUNT_NOT_FOUND' });
  });
  it('never accrues for a purchase made before the co-creator was set', async () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    await new Promise(resolve => setTimeout(resolve, 1100));
    await assign(products.later, creatorEmail, { percentage_bps: 1000 });
    const id = payment(products.later); await drain(before);
    expect(sql(`SELECT count(*) FROM public.affiliate_commissions WHERE payment_id='${id}'`)).toBe('0');
    expect(sql(`SELECT status FROM public.affiliate_work WHERE payment_id='${id}'`)).toBe('done');
  });
  it('stops accruing after the co-creator is removed', async () => {
    const revision = Number(sql(`SELECT max(revision) FROM public.affiliate_cocreator_rules WHERE product_id='${products.later}'`));
    expect(await removeProductCocreator({ product_id: products.later, expected_revision: revision })).toMatchObject({ success: true });
    await new Promise(resolve => setTimeout(resolve, 1100));
    const id = payment(products.later); await drain();
    expect(sql(`SELECT count(*) FROM public.affiliate_commissions WHERE payment_id='${id}'`)).toBe('0');
  });
  it('reverses the co-creator share on refunds like the partner share', async () => {
    const id = payment(products.split, { coupon: true }); await drain();
    sql(`UPDATE public.payment_transactions SET refunded_amount=6150 WHERE id='${id}'`); await drain();
    expect(earned(id, 'cocreator')).toBe('500');
    expect(earned(id, 'referral')).toBe('1000');
    sql(`UPDATE public.payment_transactions SET refunded_amount=12300 WHERE id='${id}'`); await drain();
    expect(earned(id, 'cocreator')).toBe('0');
    expect(earned(id, 'referral')).toBe('0');
  });
  it('holds co-creator payouts until the co-creator accepts the creator terms @J642', async () => {
    const member = memberOf(creatorUser);
    const cutoff = () => new Date(sql('SELECT clock_timestamp()')).toISOString();
    const blocked = await previewPayout({ member_id: member, currency: 'PLN', cutoff: cutoff() });
    expect(blocked).toMatchObject({ success: true, data: { available: false, payable_minor: '0' } });
    expect(BigInt(blocked.data!.held_minor)).toBeGreaterThan(BigInt(0));
    // The seed publishes demo creator terms; a new version replaces them.
    const current = sql('SELECT terms_version FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1') || null;
    const published = await publishCreatorTerms({ expected_version: current, terms_version: 'creator-v1', terms: { en: 'Creator terms', pl: 'Regulamin twórcy' } });
    expect(published).toMatchObject({ success: true });
    const stale = await (state.client as ReturnType<typeof createClient>).rpc('affiliate_creator_accept', { p_user: creatorUser, p_terms_version: 'creator-v0' });
    expect(stale.error?.code).toBe('PT409');
    const accepted = await (state.client as ReturnType<typeof createClient>).rpc('affiliate_creator_accept', { p_user: creatorUser, p_terms_version: 'creator-v1' });
    expect(accepted.error).toBeNull();
    const open = await previewPayout({ member_id: member, currency: 'PLN', cutoff: cutoff() });
    expect(open).toMatchObject({ success: true, data: { available: true } });
    expect(BigInt(open.data!.payable_minor)).toBeGreaterThan(BigInt(0));
  });
  it('shows the co-creator their current shares, accepted terms and payable rows @J642', async () => {
    const client = state.client as ReturnType<typeof createClient>;
    const member = memberOf(creatorUser);
    const asOf = new Date(sql('SELECT clock_timestamp()')).toISOString();
    const summary = await client.rpc('affiliate_portal_summary', { p_member: member, p_as_of: asOf, p_livemode: false });
    expect(summary.error).toBeNull();
    expect(summary.data).toMatchObject({ is_partner: false, codes: [], creator: { active: true, accepted_version: 'creator-v1', terms: { version: 'creator-v1', pl: 'Regulamin twórcy' } } });
    const names = (summary.data as { creator: { rules: { product: string }[] } }).creator.rules.map(rule => rule.product).sort();
    expect(names).toEqual(['Co-created Workbook', 'Creator Fixed Course', 'Creator Split Course']);
    const page = await client.rpc('affiliate_portal_page', { p_member: member, p_limit: 100, p_as_of: asOf });
    const rows = (page.data as { commissions: { product: string; kind: string; terms_required: boolean; status: string; current_minor: string }[] }).commissions;
    expect(rows.every(row => row.kind === 'cocreator' && !row.terms_required)).toBe(true);
    expect(rows.find(row => row.product === 'Creator Fixed Course')).toMatchObject({ status: 'eligible', current_minor: '1500' });
  });
  it('sends a co-creator partner application to the seller for approval and keeps the creator role', async () => {
    const member = memberOf(creatorUser);
    sql(`${asService} SELECT public.affiliate_apply('${creatorUser}','anna-partner','Anna',NULL,terms_version) FROM public.affiliate_programs;`);
    expect(sql(`SELECT id||':'||is_partner::text||':'||status||':'||(creator_accepted_at IS NOT NULL)::text FROM public.affiliate_memberships WHERE user_id='${creatorUser}'`))
      .toBe(`${member}:true:pending:true`);
    // A pending partner application must not cost the co-creator any share of new sales.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const id = payment(products.split); await drain();
    expect(earned(id, 'cocreator')).toBe('1000');
  });
});

describe('payout gates while the partner program is switched off', () => {
  const cutoff = () => new Date(sql('SELECT clock_timestamp()')).toISOString();
  const preview = () => previewPayout({ member_id: partnerMember, currency: 'PLN', cutoff: cutoff() });
  const setProgram = (enabled: boolean) => sql(`${asService}
    SELECT public.affiliate_program_update('${admin}',version,${enabled},terms_version,terms,0,0,thresholds) FROM public.affiliate_programs;`);
  async function reserve(): Promise<{ id: string; version: string; earnings_minor: string }> {
    const open = await preview();
    const result = await reservePayout({ member_id: partnerMember, currency: 'PLN', cutoff: cutoff(), member_version: open.data!.member_version,
      program_version: open.data!.program_version, payee_reference: 'partner-payee' });
    expect(result).toMatchObject({ success: true });
    return result.data!;
  }
  it('still offsets debt from a paid partner commission against co-creator shares, and exports that payout', async () => {
    // The same person is a partner (coupon) and the co-creator of another product.
    await assign(products.partnerCreated, partnerEmail, { fixed_minor: '5000', currency: 'PLN' });
    const terms = sql('SELECT terms_version FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1');
    expect((await (state.client as ReturnType<typeof createClient>).rpc('affiliate_creator_accept', { p_user: partnerUser, p_terms_version: terms })).error).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 1100));
    const referral = payment(products.referralOnly, { coupon: true }); await drain();
    expect(earned(referral, 'referral')).toBe('2000');
    // Settle everything earned so far, then refund the partner sale in full: 2000 of debt after an actual payout.
    const settled = await reserve();
    expect((await markPayoutPaid({ payout_id: settled.id, version: settled.version, bank_reference: 'bank-gate', invoice_reference: 'invoice-gate',
      bank_amount_minor: settled.earnings_minor, currency: 'PLN', paid_at: new Date().toISOString(), full_settlement: true })).success).toBe(true);
    sql(`UPDATE public.payment_transactions SET refunded_amount=12300 WHERE id='${referral}'`); await drain();
    const share = payment(products.partnerCreated); await drain();
    expect(earned(share, 'cocreator')).toBe('5000');
    expect((await preview()).data).toMatchObject({ earnings_minor: '5000', debt_offset_minor: '2000', payable_minor: '3000' });
    setProgram(false);
    try {
      expect((await preview()).data).toMatchObject({ earnings_minor: '5000', debt_offset_minor: '2000', payable_minor: '3000', available: true });
      const payout = await reserve();
      expect(payout.earnings_minor).toBe('3000');
      const csv = await downloadPayoutCsv({ payout_id: payout.id, version: payout.version });
      expect(csv.status).toBe(200);
      expect(await csv.text()).toContain('5000,2000,3000,partner-payee');
      // A reservation holding positive partner shares still cannot be exported while the program is off.
      expect((await cancelPayout({ payout_id: payout.id, version: payout.version, no_transfer: true, reason: 'Gate check' })).success).toBe(true);
      setProgram(true);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const sale = payment(products.referralOnly, { coupon: true }); await drain();
      expect(earned(sale, 'referral')).toBe('2000');
      const withPartner = await reserve();
      expect(withPartner.earnings_minor).toBe('5000');
      setProgram(false);
      expect((await downloadPayoutCsv({ payout_id: withPartner.id, version: withPartner.version })).status).toBe(409);
    } finally {
      setProgram(true);
    }
  });
});

describe('co-creator through API v1', () => {
  const url = `http://localhost/api/v1/products/${products.api}/cocreator`;
  const params = { params: Promise.resolve({ id: products.api }) };
  const put = (body: unknown) => PUT(new NextRequest(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), params);
  it('assigns, reads, refuses stale revisions and removes the co-creator @J641', async () => {
    expect(await (await GET(new NextRequest(url), params)).json()).toMatchObject({ data: { revision: 0, cocreator: null, program_configured: true } });
    const unknown = await put({ email: 'nobody-api@example.test', rule: { percentage_bps: 500 } });
    expect(unknown.status).toBe(404);
    const created = await put({ email: creatorEmail, rule: { fixed_minor: '700', currency: 'PLN' } });
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body).toMatchObject({ data: { revision: 1, cocreator: { email: creatorEmail, fixed_minor: '700', currency: 'PLN', percentage_bps: null } } });
    // The response is exactly what /api/v1/openapi.json documents.
    expect(cocreatorResponseSchema.strict().safeParse(body.data).success).toBe(true);
    expect((await put({ email: creatorEmail, rule: { percentage_bps: 500 }, expected_revision: 0 })).status).toBe(409);
    expect((await put({ email: creatorEmail, rule: { percentage_bps: 0 } })).status).toBe(400);
    const removed = await DELETE(new NextRequest(url, { method: 'DELETE' }), params);
    expect(removed.status).toBe(204);
    expect(await (await GET(new NextRequest(url), params)).json()).toMatchObject({ data: { revision: 2, cocreator: null } });
  });
});

it('deletes co-creator rules with a permanently deleted product, but never one with co-creator earnings', async () => {
  const remove = (id: string, permanent = false) => DELETE_PRODUCT(new NextRequest(`http://localhost/api/v1/products/${id}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
  expect((await remove(products.api)).status).toBe(200);
  expect((await remove(products.api, true)).status).toBe(204);
  expect(sql(`SELECT count(*) FROM public.affiliate_cocreator_rules WHERE product_id='${products.api}'`)).toBe('0');
  expect((await remove(products.fixed)).status).toBe(200);
  expect((await remove(products.fixed, true)).status).toBe(409);
  expect(sql(`SELECT count(*) FROM public.affiliate_cocreator_rules WHERE product_id='${products.fixed}'`)).toBe('1');
});
