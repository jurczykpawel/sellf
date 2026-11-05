import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
/** First trial invitation carries the actual billing date in the existing Auth template. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { purchaseEventMail } from '@/lib/events/mail';
import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';
import period from '../../fixtures/stripe/trial-display-period.json';
import invoice from '../../fixtures/stripe/trial-first-mail-invoice.json';
import { waitForEmail } from '../../helpers/mailpit';
it.each(['pl', 'en'])('reads the first trial mail with its real period in %s', async locale => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `trial-details-${crypto.randomUUID()}@example.com`;
  const u = await db.auth.admin.createUser({ email, email_confirm: false }); expect(u.error).toBeNull(); const uid = u.data.user!.id;
  const p = await db.from('products').insert({ slug: `trial-details-${crypto.randomUUID()}`, name: 'Trial details course', product_type: 'subscription', price: 11, recurring_price: 11, currency: 'PLN', billing_interval: 'month', billing_interval_count: 1, trial_days: 7 }).select('id').single(); expect(p.error).toBeNull(); const pid = p.data!.id;
  try {
    const start = new Date(period.trial_start * 1000).toISOString(), end = new Date(period.trial_end * 1000).toISOString();
    const s = await db.from('subscriptions').insert({ user_id: uid, product_id: pid, stripe_subscription_id: `sub_${crypto.randomUUID()}`, stripe_customer_id: `cus_${crypto.randomUUID()}`, status: period.status, current_period_start: start, current_period_end: end, trial_end: end }).select('id').single(); expect(s.error).toBeNull();
    const id = `in_${crypto.randomUUID().replaceAll('-', '')}`;
    expect((await db.from('payment_transactions').insert({ user_id: uid, product_id: pid, subscription_id: s.data!.id, stripe_invoice_id: id, session_id: id, amount: invoice.data.object.amount_paid, currency: 'PLN', status: 'completed', customer_email: email })).error).toBeNull();
    const data = await purchaseEventMail(email, pid, undefined, undefined, locale);
    expect(await deliverMagicLink({ email, shouldCreateUser: true, redirectTo: `${process.env.SITE_URL}/auth/callback?flow=login`, data: { ...data, locale } })).toEqual({ ok: true });
    const mail = await waitForEmail(email);
    expect(mail.HTML).toContain('Trial details course'); expect(mail.HTML).toContain('0');
    expect(mail.HTML).toContain(locale === 'pl' ? '7 dni próby' : '7-day trial');
    expect(mail.HTML).toContain(locale === 'pl' ? '8 lis 2026' : 'Nov 8, 2026');
    expect(mail.HTML).toContain('UTC');
  } finally {
    await db.from('payment_transactions').delete().eq('product_id', pid); await db.from('subscriptions').delete().eq('product_id', pid); await db.from('products').delete().eq('id', pid); await db.auth.admin.deleteUser(uid);
  }
});
