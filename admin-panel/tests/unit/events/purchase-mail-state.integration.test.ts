/**
 * Purchase details for the first access mail: a partially refunded order is still a purchase, and a
 * failed read means "not known yet", never "no purchase" — the scheduled access link a guest is owed
 * must not be dropped by either (W336r P3-2). Real local database; one read failure is simulated.
 * @see src/lib/events/mail.ts
 * @see src/lib/auth/magic-link/retry.ts
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, expect, it, vi } from 'vitest';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const failingReads = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (!failingReads.on) return db;
    const failed = { data: null, error: { message: 'connection reset' } };
    const builder: Record<string, unknown> = new Proxy({}, {
      get: (_target, key) => key === 'then' ? (resolve: (value: unknown) => void) => resolve(failed)
        : key === 'maybeSingle' || key === 'single' ? async () => failed : () => builder,
    });
    return { from: () => builder, rpc: async () => failed };
  },
}));

import { purchaseEventMail } from '@/lib/events/mail';

const run = crypto.randomUUID().slice(0, 8);
const email = `purchase-state-${run}@example.com`;
let productId: string | undefined;
afterAll(async () => {
  if (productId) {
    await db.from('payment_transactions').delete().eq('product_id', productId);
    await db.from('products').delete().eq('id', productId);
  }
});

it('a partially refunded order still carries its purchase details', async () => {
  const product = await db.from('products').insert({ name: `Partial ${run}`, slug: `partial-${run}`, price: 40, currency: 'PLN' }).select('id').single();
  expect(product.error).toBeNull(); productId = product.data!.id;
  const tx = await db.from('payment_transactions').insert({ product_id: productId, customer_email: email, amount: 4000, currency: 'PLN',
    status: 'partially_refunded', refunded_amount: 1000, session_id: `cs_partial_${run}`, pricing_snapshot_version: 1 });
  expect(tx.error).toBeNull();
  const data = await purchaseEventMail(email, productId!, undefined, undefined, 'pl', { wait: false });
  expect(data.purchase_product).toBe(`Partial ${run}`);
});

it('an unreadable purchase is reported as pending, not as missing', async () => {
  failingReads.on = true;
  try {
    expect(await purchaseEventMail(email, crypto.randomUUID(), undefined, undefined, 'pl', { wait: false })).toEqual({ purchase_mail_pending: 'true' });
  } finally {
    failingReads.on = false;
  }
});

// W351 (QA3-G U2): a subscription webhook stores the purchase 2–3 s after the confirmation page
// asks; the page waits for it (~8 s) so the first mail carries the product instead of being parked.
it('the confirmation page waits for a purchase stored a few seconds later', async () => {
  const pendingEmail = `purchase-late-${run}@example.com`;
  const tx = await db.from('payment_transactions').insert({ product_id: productId!, customer_email: pendingEmail, amount: 4000, currency: 'PLN',
    status: 'completed', fulfillment_pending: true, session_id: `cs_late_${run}`, pricing_snapshot_version: 1 }).select('id').single();
  expect(tx.error).toBeNull();
  const stored = setTimeout(() => { void db.from('payment_transactions').update({ fulfillment_pending: false }).eq('id', tx.data!.id).then(() => undefined); }, 5_000);
  try {
    const data = await purchaseEventMail(pendingEmail, productId!, undefined, undefined, 'pl');
    expect(data).toMatchObject({ purchase_product: `Partial ${run}` });
    expect(data.purchase_mail_pending).toBeUndefined();
  } finally { clearTimeout(stored); }
});

it('the confirmation page stops waiting after about 8 s and reports the purchase as pending', async () => {
  const pendingEmail = `purchase-stuck-${run}@example.com`;
  const tx = await db.from('payment_transactions').insert({ product_id: productId!, customer_email: pendingEmail, amount: 4000, currency: 'PLN',
    status: 'completed', fulfillment_pending: true, session_id: `cs_stuck_${run}`, pricing_snapshot_version: 1 });
  expect(tx.error).toBeNull();
  const started = Date.now();
  expect(await purchaseEventMail(pendingEmail, productId!, undefined, undefined, 'pl')).toEqual({ purchase_mail_pending: 'true' });
  const waited = Date.now() - started;
  expect(waited).toBeGreaterThanOrEqual(7_500);
  expect(waited).toBeLessThan(9_500);
});
