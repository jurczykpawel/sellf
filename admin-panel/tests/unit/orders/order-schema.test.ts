/** Order schema compatibility checks against the disposable local database. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { readMigrationSource } from '../../../scripts/migration-source';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let productId: string;
const ids: string[] = [];
const session = () => `cs_${crypto.randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  const slug = `order-schema-${crypto.randomUUID()}`;
  const { data, error } = await db.from('products').insert({ name: slug, slug, price: 100, currency: 'PLN' }).select('id').single();
  if (error) throw error;
  productId = data!.id;
});
afterAll(async () => {
  await db.from('guest_purchases').delete().eq('product_id', productId);
  await db.from('payment_transactions').delete().in('id', ids);
  await db.from('products').delete().eq('id', productId);
});
async function insert(extra: Record<string, unknown> = {}) {
  const result = await db.from('payment_transactions').insert({
    product_id: productId, customer_email: 'schema@example.com', amount: 10000, currency: 'PLN', ...extra,
  }).select().single();
  if (result.data) ids.push(result.data.id);
  return result;
}
describe('order schema', () => {
  it('rejects Stripe without a session', async () => {
    expect((await insert({ session_id: null })).error?.code).toBe('23514');
  });
  it('rejects bank transfer with a session or payment intent or no snapshot', async () => {
    for (const extra of [{ session_id: session() }, { stripe_payment_intent_id: 'pi_test' }, { pricing_snapshot_version: null }]) {
      expect((await insert({ payment_provider: 'bank_transfer', pricing_snapshot_version: 1, ...extra })).error?.code).toBe('23514');
    }
  });
  it('keeps the PaymentIntent of a transfer order settled online, never of an unsettled one', async () => {
    expect((await insert({ payment_provider: 'bank_transfer', pricing_snapshot_version: 1, stripe_payment_intent_id: 'pi_test', settled_via: 'bank_transfer' })).error?.code).toBe('23514');
    const settled = await insert({ payment_provider: 'bank_transfer', pricing_snapshot_version: 1, stripe_payment_intent_id: `pi_${crypto.randomUUID().replaceAll('-', '')}`, settled_via: 'stripe' });
    expect(settled.error).toBeNull();
  });
  it('accepts legacy Stripe shapes including invoices, with increasing unique numbers', async () => {
    const a = await insert({ session_id: session() });
    const b = await insert({ session_id: `in_${crypto.randomUUID().replaceAll('-', '')}` });
    expect(a.error).toBeNull(); expect(b.error).toBeNull();
    expect(a.data.pricing_snapshot_version).toBeNull();
    expect(a.data.payment_provider).toBe('stripe');
    expect(b.data.order_number).toBeGreaterThan(a.data.order_number);
    expect((await insert({ session_id: session(), order_number: a.data.order_number })).error?.code).toBe('23505');
  });
  it('defaults repeat purchase to false', async () => {
    const { data, error } = await db.from('products').select('allow_repeat_purchase').eq('id', productId).single();
    expect(error).toBeNull(); expect(data?.allow_repeat_purchase).toBe(false);
  });
  it('accepts offline guest references and rejects absent references', async () => {
    const tx = await insert({ payment_provider: 'bank_transfer', pricing_snapshot_version: 1, status: 'awaiting_payment', tax_snapshot_status: 'local' });
    expect(tx.error).toBeNull();
    const base = { product_id: productId, customer_email: 'schema@example.com', transaction_amount: 10000 };
    expect((await db.from('guest_purchases').insert(base)).error?.code).toBe('23514');
    expect((await db.from('guest_purchases').insert({ ...base, transaction_id: tx.data.id })).error).toBeNull();
    expect((await db.from('guest_purchases').insert({ ...base, transaction_id: tx.data.id })).error?.code).toBe('23505');
  });
  it('backfills historical order numbers and guest transaction references', () => {
    const migration = readMigrationSource('20261022191538_order_core_schema.sql').replace(/^BEGIN;|^COMMIT;/gm, '');
    const historicalClaim = readFileSync('../supabase/migrations/20261003120000_claim_after_email_confirmation.sql', 'utf8')
      .split('CREATE OR REPLACE FUNCTION public.migrate_guest_payment_data_to_profile')[0];
    const sql = `BEGIN;
      ${historicalClaim}
      DROP TRIGGER IF EXISTS bank_transfer_access_release ON public.payment_transactions;
      DELETE FROM public.invoices WHERE transaction_id IN (SELECT id FROM public.payment_transactions WHERE payment_provider='bank_transfer');
      DELETE FROM public.payment_transactions WHERE payment_provider='bank_transfer';
      DELETE FROM public.guest_purchases WHERE product_id='${productId}';
      DELETE FROM public.payment_transactions WHERE product_id='${productId}';
      ALTER TABLE public.payment_transactions DROP COLUMN payment_provider, DROP COLUMN pricing_snapshot_version, DROP COLUMN coupon_id, DROP COLUMN livemode;
      ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_session_id_check CHECK (session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$');
      ALTER TABLE public.payment_line_items DROP COLUMN discounted_total;
      ALTER TABLE public.products DROP COLUMN allow_repeat_purchase;
      ALTER TABLE public.guest_purchases DROP COLUMN transaction_id;
      ALTER TABLE public.payment_transactions DROP COLUMN order_number;
      ALTER TABLE public.guest_purchases ADD CONSTRAINT guest_purchases_session_id_check CHECK (session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$');
      INSERT INTO public.payment_transactions(id, product_id, customer_email, amount, currency, session_id, created_at)
      VALUES ('00000000-0000-4000-8000-000000000101', '${productId}', 'backfill@example.com', 100, 'PLN', 'cs_backfill_old', '2000-01-01'),
             ('00000000-0000-4000-8000-000000000102', '${productId}', 'backfill@example.com', 100, 'PLN', 'cs_backfill_new', '2000-01-02'),
             ('00000000-0000-4000-8000-000000000103', '${productId}', 'backfill@example.com', 100, 'PLN', 'cs_backfill_tie', '2000-01-01');
      INSERT INTO public.guest_purchases(product_id,customer_email,transaction_amount,session_id)
      VALUES ('${productId}', 'backfill@example.com', 100, 'cs_backfill_old');
      ${migration}
      DO $$ BEGIN
        IF (SELECT min(order_number) FROM public.payment_transactions) <> 1001
          OR (SELECT order_number FROM public.payment_transactions WHERE session_id='cs_backfill_tie') <>
            (SELECT order_number + 1 FROM public.payment_transactions WHERE session_id='cs_backfill_old')
          OR (SELECT order_number FROM public.payment_transactions WHERE session_id='cs_backfill_new') <=
            (SELECT order_number FROM public.payment_transactions WHERE session_id='cs_backfill_tie')
          OR (SELECT transaction_id FROM public.guest_purchases WHERE session_id='cs_backfill_old') IS DISTINCT FROM '00000000-0000-4000-8000-000000000101'::uuid
        THEN RAISE EXCEPTION 'Historical backfill differs'; END IF;
      END $$; ROLLBACK;`;
    expect(() => execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] })).not.toThrow();
  });
});
