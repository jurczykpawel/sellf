import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
import { getAffiliateTestConfig, resetAffiliateDatabase } from '../database';
/** Isolated worker/source integration. @see worker.test.ts */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { drainAffiliateWork } from '@/lib/affiliates/sync/worker';
import { calculateCommission } from '../oracles/money';
import { reduceLoss } from '../oracles/loss';

const state = vi.hoisted(() => ({ client: undefined as unknown, duringLookup: undefined as (() => void) | undefined }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: async () => ({ checkout: { sessions: {
  list: async () => ({ data: [], has_more: false }),
  retrieve: async (id: string) => {
    state.duringLookup?.(); state.duringLookup = undefined;
    return { id, created: 1767312000, livemode: false };
  },
} } }) }));

// This harness targets only the disposable stack, regardless of application env.
function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
const product = 'af000000-0000-4000-a000-000000000002';
const coupon = 'af000000-0000-4000-a000-000000000005';
function fixture(options: { pending?: boolean; net?: boolean; email?: string } = {}): string {
  const id = randomUUID();
  sql(`INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,session_id,fulfillment_pending,metadata)
    VALUES('${id}','${product}','${options.email ?? 'worker-buyer@example.test'}',12300,'PLN','completed','cs_test_${id.replaceAll('-', '')}',${options.pending ?? false},'{"sentinel":"kept"}');
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,net_amount)
    VALUES('${id}','${product}','main_product',1,123,123,'PLN',${options.net === false ? 'NULL' : '10000'});
    INSERT INTO public.coupon_redemptions(coupon_id,transaction_id,customer_email,discount_amount)
    VALUES('${coupon}','${id}','checkout-initial@example.test',10);`);
  return id;
}
function balance(id: string): string {
  return sql(`SELECT coalesce(sum(l.amount_minor),0)::text FROM affiliate_ledger l JOIN affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='${id}'`);
}
async function drain(): Promise<void> {
  expect(await drainAffiliateWork(100)).toMatchObject({ success: true, data: { failed: 0 } });
}
beforeAll(() => {
  resetAffiliateDatabase();
  const env = getAffiliateTestConfig();
  state.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
});

describe('worker against isolated source writes', () => {
  it('deduplicates the common completion RPC used by the four paid entry points', async () => {
    const session = `cs_test_${randomUUID().replaceAll('-', '')}`;
    const email = `${randomUUID()}@example.test`;
    sql(`INSERT INTO coupon_reservations(coupon_id,customer_email,expires_at) VALUES('${coupon}','${email}',now()+interval '1 hour')`);
    for (let i = 0; i < 4; i++) {
      const result = JSON.parse(sql(`SELECT process_stripe_payment_completion_with_bump('${session}','${product}','${email}',12300,'PLN',coupon_id_param=>'${coupon}')`));
      expect(result.success).toBe(true);
    }
    const id = sql(`SELECT id FROM payment_transactions WHERE session_id='${session}'`);
    expect(sql(`SELECT count(*) FROM coupon_redemptions WHERE transaction_id='${id}'`)).toBe('1');
    expect(sql(`SELECT count(*) FROM affiliate_work WHERE payment_id='${id}'`)).toBe('1');
    sql(`UPDATE payment_line_items SET net_amount=10000 WHERE transaction_id='${id}'; UPDATE payment_transactions SET fulfillment_pending=false WHERE id='${id}'`);
    await drain(); expect(balance(id)).toBe('2000');
    for (const refund of [1000, 2000, 3075, 6150, 12300]) {
      sql(`UPDATE payment_transactions SET refunded_amount=${refund} WHERE id='${id}'`);
    }
    await drain(); expect(balance(id)).toBe('0');
    expect(sql(`SELECT count(*) FROM affiliate_commissions WHERE payment_id='${id}'`)).toBe('1');
  });
  it('accrues an inserted paid embed order once and preserves payment metadata', async () => {
    const id = fixture(); await drain();
    expect(calculateCommission({ base_minor: '10000', currency: 'PLN', rule: { percentage_bps: 2000 } })).toEqual({ success: true, data: balance(id) });
    for (let i = 0; i < 20; i++) {
      sql(`UPDATE payment_transactions SET refunded_amount=${i % 2} WHERE id='${id}'`);
    }
    await drain(); await drain();
    expect(sql(`SELECT count(*) FROM affiliate_ledger l JOIN affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='${id}' AND l.kind='accrual'`)).toBe('1');
    expect(sql(`SELECT metadata->>'sentinel' FROM payment_transactions WHERE id='${id}'`)).toBe('kept');
  });
  it('waits for fulfillment and net snapshots then uses the final guest email', async () => {
    const email = sql("SELECT email FROM auth.users WHERE id='bbbbbbbb-0000-4000-a000-000000000000'");
    const id = fixture({ pending: true, net: false }); await drain(); expect(balance(id)).toBe('0');
    sql(`UPDATE payment_transactions SET fulfillment_pending=false WHERE id='${id}'`);
    await drain(); expect(sql(`SELECT status FROM affiliate_work WHERE payment_id='${id}'`)).toBe('needs_review');
    expect(sql(`SELECT last_error_code FROM affiliate_work WHERE payment_id='${id}'`)).toBe('net_unavailable');
    sql(`UPDATE payment_line_items SET net_amount=10000 WHERE transaction_id='${id}';
      UPDATE payment_transactions SET customer_email='${email.toUpperCase()}' WHERE id='${id}';
      SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
      SELECT affiliate_work_retry('dddddddd-0000-4000-a000-000000000000','${id}',requested_generation,'Net snapshot ready') FROM affiliate_work WHERE payment_id='${id}';`);
    await drain();
    expect(sql(`SELECT self_referral AND accrued_minor=0 FROM affiliate_commissions WHERE payment_id='${id}'`)).toBe('t');
  });
  it('applies cumulative refunds, decreases, full loss and the dispute latch', async () => {
    const id = fixture(); await drain();
    for (const refund of [3075, 6150, 12300, 6150, 0]) {
      sql(`UPDATE payment_transactions SET refunded_amount=${refund} WHERE id='${id}'`); await drain();
      const expected = reduceLoss({ gross_minor: '12300', base_minor: '10000', accrued_minor: '2000', refunded_gross_minor: String(refund), status: 'completed', dispute_seen: false, entries: [{ kind: 'accrual', amount_minor: '2000' }] });
      expect(balance(id)).toBe(expected.success ? expected.data.target_minor : 'invalid');
    }
    sql(`UPDATE payment_transactions SET status='disputed' WHERE id='${id}'; UPDATE payment_transactions SET status='completed' WHERE id='${id}'`);
    await drain(); expect(balance(id)).toBe('0');
    sql(`UPDATE payment_transactions SET refunded_amount=12300 WHERE id='${id}'`); await drain();
    expect(balance(id)).toBe('0');
  });
  it('retains a generation enqueued during lookup and recovers an expired lease', async () => {
    const id = fixture();
    state.duringLookup = () => { sql(`UPDATE payment_transactions SET refunded_amount=6150 WHERE id='${id}'`); };
    await drain();
    expect(balance(id)).toBe('1000');
    expect(sql(`SELECT status='pending' AND requested_generation>processed_generation FROM affiliate_work WHERE payment_id='${id}'`)).toBe('t');
    const old = sql(`SELECT lease_token FROM affiliate_claim_work(100) WHERE payment_id='${id}'`);
    sql(`UPDATE affiliate_work SET leased_until=now()-interval '1 second' WHERE payment_id='${id}'`);
    await drain(); expect(balance(id)).toBe('1000');
    expect(sql(`SELECT affiliate_apply_sync('${id}','${old}',2,'2026-01-02',false)`)).toBe('f');
  });
  it('keeps unresolved sessions durable and marks repeated failure for review', async () => {
    const id = fixture();
    sql(`UPDATE payment_transactions SET session_id='pi_test_${id.replaceAll('-', '')}' WHERE id='${id}'`);
    for (let attempt = 1; attempt <= 10; attempt++) {
      sql(`UPDATE affiliate_work SET next_attempt_at=now() WHERE payment_id='${id}'`);
      expect(await drainAffiliateWork(100)).toMatchObject({ success: true, data: { failed: 1 } });
      expect(sql(`SELECT status FROM affiliate_work WHERE payment_id='${id}'`)).toBe(attempt === 10 ? 'needs_review' : 'pending');
    }
    expect(balance(id)).toBe('0');
    expect(sql(`SELECT last_error_code FROM affiliate_work WHERE payment_id='${id}'`)).toBe('session_unresolved');
  });
  it('corrects existing accrual while fulfillment is pending', async () => {
    const id = fixture(); await drain();
    sql(`UPDATE payment_transactions SET refunded_amount=6150,fulfillment_pending=true WHERE id='${id}'`);
    await drain(); expect(balance(id)).toBe('1000');
    expect(sql(`SELECT status FROM affiliate_work WHERE payment_id='${id}'`)).toBe('pending');
    sql(`UPDATE payment_transactions SET fulfillment_pending=false WHERE id='${id}'`); await drain();
    expect(balance(id)).toBe('1000');
  });
  it('preserves bigint generations across the real RPC boundary', async () => {
    const id = fixture();
    sql(`UPDATE affiliate_work SET requested_generation=9007199254740993 WHERE payment_id='${id}'`);
    await drain(); expect(balance(id)).toBe('2000');
    expect(sql(`SELECT processed_generation::text FROM affiliate_work WHERE payment_id='${id}'`)).toBe('9007199254740993');
  });
  it('latches a dispute before the initial drain', async () => {
    const id = fixture();
    sql(`UPDATE payment_transactions SET status='disputed' WHERE id='${id}'; UPDATE payment_transactions SET status='completed' WHERE id='${id}'`);
    await drain(); expect(balance(id)).toBe('0');
    expect(sql(`SELECT count(*) FROM affiliate_ledger l JOIN affiliate_commissions c ON c.id=l.commission_id WHERE c.payment_id='${id}'`)).toBe('2');
  });
});
