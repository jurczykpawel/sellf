import { resetAffiliateDatabase } from '../database';
/** Seeded portal acceptance. @see src/lib/affiliates/portal/service.ts */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, expect, it, vi } from 'vitest';
import AffiliatePortal from '@/components/affiliates/portal/AffiliatePortal';
import { readPartnerPortal, readAdminPortal, portalResponse } from '@/lib/affiliates/portal/service';
const state = vi.hoisted(() => ({ client: undefined as unknown, user: 'bbbbbbbb-0000-4000-a000-000000000000' }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), connection: async () => {} }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) } }) }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({}) }));
function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_sellf-afffix', 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET request.jwt.claims='{"role":"service_role"}'; ${statement}`], { encoding: 'utf8' }).trim();
}
const member = 'af000000-0000-4000-a000-000000000001';
const otherUser = randomUUID(), otherMember = randomUUID(), otherCoupon = randomUUID();
beforeAll(() => {
  resetAffiliateDatabase();
  const env = JSON.parse(execFileSync('supabase', ['status', '--workdir', '/private/tmp/sellf-afffix', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  expect(env.API_URL).toBe('http://127.0.0.1:55531');
  state.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  sql(`INSERT INTO auth.users(id,email) VALUES('${otherUser}','portal-${otherUser}@example.test');
    INSERT INTO affiliate_memberships(id,user_id,code,status,display_name,accepted_terms_version,accepted_at,created_at)
    VALUES('${otherMember}','${otherUser}','p_${otherMember.slice(0, 8)}','approved','Other partner','demo-v1',now(),'2026-01-01');
    INSERT INTO affiliate_membership_events(member_id,version,status,created_at) VALUES('${otherMember}',1,'approved','2026-01-01');
    INSERT INTO coupons(id,code,discount_type,discount_value,is_active) VALUES('${otherCoupon}','${otherCoupon}','percentage',10,true);
    INSERT INTO affiliate_coupon_bindings(coupon_id,member_id,version,created_at) VALUES('${otherCoupon}','${otherMember}',1,'2026-01-01');
    DO $$ DECLARE p uuid; w affiliate_work; BEGIN
      FOR i IN 1..101 LOOP
        p:=gen_random_uuid();
        INSERT INTO payment_transactions(id,product_id,customer_email,amount,currency,status,session_id,fulfillment_pending,metadata)
        VALUES(p,'af000000-0000-4000-a000-000000000003','buyer-sentinel@example.test',12300,'EUR','completed','cs_portal_'||replace(p::text,'-',''),false,'{"buyer":"buyer-sentinel"}');
        INSERT INTO payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,net_amount)
        VALUES(p,'af000000-0000-4000-a000-000000000003','main_product',1,123,123,'EUR',10000);
        INSERT INTO coupon_redemptions(coupon_id,transaction_id,customer_email,discount_amount,redeemed_at)
        VALUES('${otherCoupon}',p,'buyer-sentinel@example.test',10,'2026-01-02');
      END LOOP;
      FOR i IN 1..2 LOOP
        FOR w IN SELECT * FROM affiliate_claim_work(100) LOOP
          PERFORM affiliate_apply_sync(w.payment_id,w.lease_token,w.requested_generation,'2026-01-02',true);
        END LOOP;
      END LOOP;
    END $$;`);

});
it('reads own seeded codes, latest product rules and exact PLN/EUR totals', async () => {
  const result = await readPartnerPortal({ limit: 1 });
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.member.code).toBe('demo-partner');
  expect(result.data.codes).toContainEqual({ code: 'PARTNER10', active: true });
  expect(result.data.rules).toHaveLength(3);
  expect(result.data.balances).toMatchObject([{ currency: 'EUR', accrued: '2000' }, { currency: 'PLN', accrued: '4000', held: '2000' }]);
  expect(result.data.commissions).toHaveLength(1);
  expect(['Affiliate PLN Course', 'Affiliate EUR Toolkit', 'Affiliate Unlimited Course']).toContain(result.data.commissions[0].product);
  expect(['eligible', 'held']).toContain(result.data.commissions[0].status);
  const next = await readPartnerPortal({ limit: 1, cursor: result.data.next_cursor });
  expect(next.success && next.data.commissions[0].reference).not.toBe(result.data.commissions[0].reference);
  expect(await readPartnerPortal({ limit: 100, currency: 'EUR' })).toMatchObject({ success: true, data: { commissions: [{ currency: 'EUR' }], next_cursor: null } });
  const output = JSON.stringify(result);
  for (const field of ['customer_email', 'payment_id', 'line_item_id', 'user_id', 'bank_reference', 'invoice_reference', 'stripe', 'license', 'affiliate-customer@example.com']) expect(output).not.toContain(field);
});
it('keeps two memberships separate across a full 100-row page and an own cursor', async () => {
  const a = await readPartnerPortal({ limit: 1 });
  state.user = otherUser;
  try {
    const b = await readPartnerPortal({ limit: 100 });
    expect(b).toMatchObject({ success: true, data: { member: { code: `p_${otherMember.slice(0, 8)}` } } });
    if (!b.success || !a.success) return;
    expect(b.data.commissions).toHaveLength(100);
    expect(b.data.codes).toEqual([{ code: otherCoupon, active: true }]);
    const last = await readPartnerPortal({ limit: 100, cursor: b.data.next_cursor });
    expect(last.success && last.data.commissions).toHaveLength(1);
    expect(last.success && last.data.next_cursor).toBeNull();
    expect(b.data.commissions.map(c => c.reference)).not.toContain(a.data.commissions[0].reference);
    for (const output of [JSON.stringify(b), renderToStaticMarkup(createElement(AffiliatePortal, { data: b.data, locale: 'en' }))]) {
      expect(output).not.toContain('buyer-sentinel'); expect(output).not.toContain('demo-partner'); expect(output).not.toContain('PARTNER10');
    }
  } finally { state.user = 'bbbbbbbb-0000-4000-a000-000000000000'; }
});
it('shows source lag and review without returning payment diagnostics', async () => {
  sql("UPDATE affiliate_work SET status='needs_review',attempts=10,last_error_code='sync_failed' WHERE payment_id='af000000-0000-4000-a000-000000000010'");
  const result = await readAdminPortal(member);
  expect(result).toMatchObject({ success: true, data: { sync_pending: true, needs_review: true, lag: { pending: 1, needs_review: 1, retrying: 1, errors: { sync_failed: 1, session_unresolved: 0, awaiting_fulfillment: 0 } } } });
  const response = portalResponse(result);
  expect(await response.text()).not.toContain('buyer-sentinel');
  sql("UPDATE affiliate_work SET status='done',attempts=0,last_error_code=NULL WHERE payment_id='af000000-0000-4000-a000-000000000010'");
});

it('reconciles recorded allocations, settlements and a refund after payment', async () => {
  const actor = 'dddddddd-0000-4000-a000-000000000000';
  const payout = JSON.parse(sql(`SELECT row_to_json(p) FROM affiliate_reserve('${actor}','${otherMember}','EUR',now(),1,1,'portal-payee') p`));
  state.user = otherUser;
  try {
    expect(await readPartnerPortal()).toMatchObject({ success: true, data: { balances: [{ reserved: '202000', paid: '0', balance: '202000' }] } });
    sql(`SELECT affiliate_mark_paid('${actor}','${payout.id}',1,'bank-${payout.id}','invoice-sentinel',202000,'EUR',now(),true);
      UPDATE payment_transactions SET refunded_amount=12300 WHERE id=(SELECT payment_id FROM affiliate_commissions WHERE member_id='${otherMember}' ORDER BY id LIMIT 1);
      DO $$ DECLARE w affiliate_work; BEGIN
        FOR w IN SELECT * FROM affiliate_claim_work(100) LOOP
          PERFORM affiliate_apply_sync(w.payment_id,w.lease_token,w.requested_generation,'2026-01-02',true);
        END LOOP;
      END $$;`);
    const result = await readPartnerPortal();
    expect(result).toMatchObject({ success: true, data: { balances: [{ accrued: '202000', reversed: '2000', paid: '202000', reserved: '0', eligible: '0', debt: '2000', balance: '-2000' }] } });
    expect(result.success && result.data.commissions.every(c => ['paid', 'reversed'].includes(c.status))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('invoice-sentinel');
    expect(JSON.stringify(result)).not.toContain('bank-');
  } finally { state.user = 'bbbbbbbb-0000-4000-a000-000000000000'; }
});
