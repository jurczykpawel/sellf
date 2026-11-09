/** Guest order claims follow the current payment state. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> {
  if (error) throw error;
  return data;
}

it.each([null, 'session', 'legacy'] as const)('full refund removes the guest order before email confirmation (%s) @J185', async (kind) => {
  const id = randomUUID(), email = `guest-${id}@example.com`;
  const product = await checked(await db.from('products').insert({ name: 'Guest order', slug: `guest-${id}`, price: 20, currency: 'PLN' }).select('id').single());
  let userId: string | undefined;
  try {
    const tx = await checked(await db.from('payment_transactions').insert({ product_id: product!.id, customer_email: email, amount: 2000, currency: 'PLN', status: 'completed', payment_provider: kind ? 'stripe' : 'bank_transfer', pricing_snapshot_version: 1, session_id: kind ? `cs_${id.replaceAll('-', '')}` : null }).select('id,session_id').single());
    await checked(await db.from('guest_purchases').insert({ product_id: product!.id, customer_email: email, transaction_amount: 2000, transaction_id: kind === 'legacy' ? null : tx!.id, session_id: tx!.session_id }));
    await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 2000 }).eq('id', tx!.id));
    const result = await revokeTransactionAccess(db, { transactionId: tx!.id, productId: product!.id, userId: null, sessionId: tx!.session_id });
    expect(result.success).toBe(true);
    expect(await checked(await db.from('guest_purchases').select('id').eq('product_id', product!.id))).toHaveLength(0);
    const user = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
    userId = user.user!.id;
    await checked(await db.rpc('claim_guest_purchases_for_user', { p_user_id: userId }));
    expect(await checked(await db.from('user_product_access').select('id').eq('user_id', userId).eq('product_id', product!.id))).toHaveLength(0);
  } finally {
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('payment_transactions').delete().eq('product_id', product!.id);
    await db.from('products').delete().eq('id', product!.id);
  }
});

const claimCases = (['refunded', 'disputed', 'cancelled', 'completed', 'partially_refunded', 'awaiting_payment'] as const)
  .flatMap(status => (['transaction', 'session', 'legacy'] as const).map(kind => ({ status, kind, refundedAmount: status === 'partially_refunded' ? 1000 : status === 'refunded' ? 2000 : 0 })));
claimCases.push({ status: 'completed', kind: 'transaction', refundedAmount: 2000 });
it.each(claimCases)('email confirmation follows transaction status $status ($kind, refunded $refundedAmount) @J185', async ({ status, kind, refundedAmount }) => {
  const id = randomUUID(), email = `claim-${id}@example.com`;
  const product = await checked(await db.from('products').insert({ name: 'Claim order', slug: `claim-${id}`, price: 20, currency: 'PLN' }).select('id').single());
  const bump = await checked(await db.from('products').insert({ name: 'Claim bump', slug: `bump-${id}`, price: 5, currency: 'PLN' }).select('id').single());
  let userId: string | undefined;
  try {
    const tx = await checked(await db.from('payment_transactions').insert({ product_id: product!.id, customer_email: email, amount: 2000, currency: 'PLN', status, refunded_amount: refundedAmount, payment_provider: kind === 'transaction' ? 'bank_transfer' : 'stripe', pricing_snapshot_version: 1, session_id: kind === 'transaction' ? null : `cs_${id.replaceAll('-', '')}` }).select('id,session_id').single());
    await checked(await db.from('guest_purchases').insert({ product_id: product!.id, customer_email: email, transaction_amount: 2000, transaction_id: kind === 'legacy' ? null : tx!.id, session_id: tx!.session_id }));
    await checked(await db.from('payment_line_items').insert({ transaction_id: tx!.id, product_id: bump!.id, item_type: 'order_bump', quantity: 1, unit_price: 500, total_price: 500, currency: 'PLN' }));
    const user = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
    userId = user.user!.id;
    await checked(await db.rpc('claim_guest_purchases_for_user', { p_user_id: userId }));
    const access = await checked(await db.from('user_product_access').select('id').eq('user_id', userId).in('product_id', [product!.id, bump!.id]));
    expect(access).toHaveLength(['completed', 'partially_refunded', 'awaiting_payment'].includes(status) && refundedAmount < 2000 ? 2 : 0);
  } finally {
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('payment_transactions').delete().eq('product_id', product!.id);
    await db.from('products').delete().in('id', [product!.id, bump!.id]);
  }
});

it('claim retains another completed order for the same product @J185', async () => {
  const id = randomUUID(), email = `repeat-${id}@example.com`;
  const product = await checked(await db.from('products').insert({ name: 'Repeat order', slug: `repeat-${id}`, price: 20, currency: 'PLN' }).select('id').single());
  let userId: string | undefined;
  try {
    const transactions = await checked(await db.from('payment_transactions').insert(['refunded', 'completed'].map(status => ({ product_id: product!.id, customer_email: email, amount: 2000, currency: 'PLN', status, payment_provider: 'bank_transfer', pricing_snapshot_version: 1 }))).select('id,status'));
    await checked(await db.from('guest_purchases').insert(transactions!.map(tx => ({ product_id: product!.id, customer_email: email, transaction_amount: 2000, transaction_id: tx.id }))));
    const refunded = transactions!.find(tx => tx.status === 'refunded')!;
    expect((await revokeTransactionAccess(db, { transactionId: refunded.id, productId: product!.id, userId: null, sessionId: null })).success).toBe(true);
    const remaining = await checked(await db.from('guest_purchases').select('transaction_id').eq('product_id', product!.id));
    expect(remaining).toEqual([{ transaction_id: transactions!.find(tx => tx.status === 'completed')!.id }]);
    const user = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
    userId = user.user!.id;
    await checked(await db.rpc('claim_guest_purchases_for_user', { p_user_id: userId }));
    expect(await checked(await db.from('user_product_access').select('id').eq('user_id', userId).eq('product_id', product!.id))).toHaveLength(1);
  } finally {
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('payment_transactions').delete().eq('product_id', product!.id);
    await db.from('products').delete().eq('id', product!.id);
  }
});

it.each(['unchanged', 'metadata', 'admin', 'replacement'] as const)('full online refund releases placement access after %s changes @J185', (kind) => {
  const sql = `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    DO $test$ DECLARE buyer uuid:=gen_random_uuid(); participant uuid:=gen_random_uuid();
      p uuid; recording uuid; bump uuid; tx jsonb; attempt jsonb; txid uuid; BEGIN
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
        (buyer,'placement-buyer@example.com',now()),(participant,'placement-participant@example.com',now());
      INSERT INTO public.products(name,slug,price,currency,checkout_profile) VALUES('Placement','placement-refund',100,'PLN',
        '{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}') RETURNING id INTO p;
      INSERT INTO public.products(name,slug,price,currency) VALUES('Recording','placement-recording',20,'PLN') RETURNING id INTO recording;
      INSERT INTO public.order_bumps(main_product_id,bump_product_id,bump_title) VALUES(p,recording,'Recording') RETURNING id INTO bump;
      UPDATE public.bank_transfer_config SET bank_transfer_enabled=true,bank_transfer_grant_access_on_placement=true;
      tx:=public.bank_transfer_order(jsonb_build_object('product_id',p,'currency','PLN','customer_email','placement-buyer@example.com','order_details',
        '{"v":1,"buyer":{"type":"organization","terms_accepted":true},"participants":{"people":[{"email":"placement-participant@example.com"}]}}'::jsonb),
        jsonb_build_array(jsonb_build_object('product_id',p,'item_type','main_product','quantity',1,'unit_price',100,'total_price',100,'discounted_total',100,'currency','PLN'),
        jsonb_build_object('product_id',recording,'item_type','order_bump','order_bump_id',bump,'quantity',1,'unit_price',20,'total_price',20,'discounted_total',20,'currency','PLN')));
      txid:=(tx->>'transaction_id')::uuid;
      ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=recording);
      attempt:=public.open_order_payment_attempt(txid,'settle',12000,'PLN',now()+interval '30 minutes',now());
      PERFORM public.attach_order_payment_session((attempt->>'id')::uuid,'cs_placement_refund','https://example.com/checkout');
      ASSERT public.complete_order_payment_attempt((attempt->>'id')::uuid,'cs_placement_refund','pi_placement_refund',12000,now())->>'result'='completed';
      ${kind === 'metadata' ? `UPDATE public.user_product_access SET expiry_notified_at=now() WHERE transfer_transaction_id=txid;` : ''}
      ${kind === 'admin' ? `PERFORM public.mutate_access('update',participant,NULL,(SELECT id FROM public.user_product_access WHERE user_id=participant AND product_id=recording),jsonb_build_object('access_expires_at',now()+interval '30 days'),jsonb_build_object('type','user','id',buyer));` : ''}
      ${kind === 'replacement' ? `PERFORM public.grant_product_access_service_role(participant,recording);` : ''}
      UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id=txid;
      ASSERT NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id IN(${kind === 'replacement' ? 'buyer' : 'buyer,participant'}) AND product_id IN(p,recording)), 'Placement access remains after refund';
      ${kind === 'replacement' ? `ASSERT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id=participant AND product_id=recording AND transfer_transaction_id IS NULL), 'Replacement access must remain';` : ''}
      ASSERT NOT EXISTS(SELECT 1 FROM public.guest_purchases WHERE transaction_id=txid), 'Placement guest claims remain after refund';
    END $test$;
    ROLLBACK;`;
  expect(() => execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })).not.toThrow();
});
