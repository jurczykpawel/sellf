/** Zero-total subscription invoices remain distinct from positive-price orders. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import recording from '../../fixtures/stripe/trial-first-mail-invoice.json';

it('persists the recorded trial total while preserving order bounds and write roles', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `trial-amount-${crypto.randomUUID()}@example.com`, password = 'TrialAmount123!';
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true }); expect(user.error).toBeNull();
  const uid = user.data.user!.id;
  const product = await db.from('products').insert({ name: 'Trial amount', slug: `trial-amount-${crypto.randomUUID()}`, price: 17, currency: 'PLN', product_type: 'subscription', recurring_price: 17, billing_interval: 'month', billing_interval_count: 1 }).select('id').single(); expect(product.error).toBeNull();
  const pid = product.data!.id;
  try {
    const sub = await db.from('subscriptions').insert({ user_id: uid, product_id: pid, stripe_subscription_id: `sub_${crypto.randomUUID()}`, stripe_customer_id: `cus_${crypto.randomUUID()}`, status: 'trialing' }).select('id').single(); expect(sub.error).toBeNull();
    const invoice = `in_${crypto.randomUUID().replaceAll('-', '')}`;
    const row = { user_id: uid, product_id: pid, subscription_id: sub.data!.id, stripe_invoice_id: invoice, session_id: invoice, amount: recording.data.object.amount_paid, currency: recording.data.object.currency.toUpperCase(), status: 'completed', customer_email: email };
    expect((await db.from('payment_transactions').insert(row)).error).toBeNull();
    for (const patch of [{ subscription_id: null }, { stripe_invoice_id: null }, { amount: -1 }, { amount: 100000000 }]) {
      expect((await db.from('payment_transactions').insert({ ...row, stripe_invoice_id: `in_${crypto.randomUUID().replaceAll('-', '')}`, session_id: `in_${crypto.randomUUID().replaceAll('-', '')}`, ...patch })).error?.code).toBe('23514');
    }
    for (const signedIn of [false, true]) {
      const client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      if (signedIn) expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      expect((await client.from('payment_transactions').insert({ ...row, stripe_invoice_id: `in_${crypto.randomUUID().replaceAll('-', '')}`, session_id: `in_${crypto.randomUUID().replaceAll('-', '')}` })).error).not.toBeNull();
    }
  } finally {
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('subscriptions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
    await db.auth.admin.deleteUser(uid);
  }
});
