import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
/** The first purchase receipt waits for fulfillment and remains separate from content access. */
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { runAuthMailRetries } from '@/lib/auth/magic-link/retry';
import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { upsertUserProductAccess } from '@/app/api/webhooks/stripe/subscription-handlers';
import recorded from '../../fixtures/stripe/subscription-first-mail.json';
import { extractMagicLink, searchMessages, waitForEmail } from '../../helpers/mailpit';

vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: async () => ({ success: true }) }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction: async () => ({ isValid: true }) }));
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const users: string[] = [], products: string[] = [];
afterEach(async () => {
  for (const id of products) {
    await db.from('user_product_access').delete().eq('product_id', id);
    await db.from('guest_purchases').delete().eq('product_id', id);
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('subscriptions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
  for (const id of users) {
    const user = await db.auth.admin.getUserById(id);
    await db.from('auth_mail_retries').delete().eq('email', user.data.user!.email!);
    await db.auth.admin.deleteUser(id);
  }
  users.length = 0; products.length = 0;
});
it.each(['pl', 'en'].flatMap(locale => [false, true].flatMap(confirmed => [false, true].map(subscription => ({ locale, confirmed, subscription, finishesDuringWait: false }))))
  .concat([{ locale: 'pl', confirmed: false, subscription: true, finishesDuringWait: true }]))('waits for fulfillment before the first purchase mail: %j', async ({ locale, confirmed, subscription, finishesDuringWait }) => {
  const email = `sub-first-${crypto.randomUUID()}@example.com`;
  const user = await db.auth.admin.createUser({ email, email_confirm: confirmed }); expect(user.error).toBeNull(); const uid = user.data.user!.id; users.push(uid);
  const product = await db.from('products').insert({ name: 'Subscription workshop', slug: `sub-first-${crypto.randomUUID()}`, price: 17, currency: 'PLN', ...(subscription ? { product_type: 'subscription', recurring_price: 17, billing_interval: 'month', billing_interval_count: 1 } : {}), is_active: true }).select('id,slug').single(); expect(product.error).toBeNull(); const pid = product.data!.id; products.push(pid);
  const sub = subscription ? await db.from('subscriptions').insert({ user_id: uid, product_id: pid, ...recorded.subscription, stripe_subscription_id: `sub_${crypto.randomUUID()}` }).select('id').single() : { data: { id: null }, error: null }; expect(sub.error).toBeNull();
  const invoiceId = `in_${crypto.randomUUID().replaceAll('-', '')}`;
  const tx = await db.from('payment_transactions').insert({ ...recorded.payment, amount: Number(recorded.payment.amount), session_id: invoiceId, stripe_invoice_id: invoiceId, stripe_payment_intent_id: null, user_id: uid, customer_email: email.toUpperCase(), product_id: pid, subscription_id: subscription ? sub.data!.id : null, fulfillment_pending: true }).select('id').single(); expect(tx.error).toBeNull();
  if (subscription) expect(await upsertUserProductAccess(db, uid, pid, sub.data!.id!)).toEqual({ ok: true });
  else if (confirmed) expect((await db.from('user_product_access').insert({ user_id: uid, product_id: pid })).error).toBeNull();
  expect((await db.from('user_product_access').select('id').eq('user_id', uid).eq('product_id', pid)).data).toHaveLength(confirmed ? 1 : 0);
  if (!subscription && !confirmed) expect((await db.from('guest_purchases').insert({ product_id: pid, customer_email: email, transaction_id: tx.data!.id, transaction_amount: Number(recorded.payment.amount) })).error).toBeNull();
  expect(await searchMessages(email)).toHaveLength(0);
  const finishing = finishesDuringWait ? new Promise(resolve => setTimeout(resolve, 700)).then(async () => {
    expect((await db.from('payment_transactions').update({ fulfillment_pending: false }).eq('id', tx.data!.id)).error).toBeNull();
  }) : null;
  expect(await requestMagicLink({ flow: 'post_checkout', email, productSlug: product.data!.slug, locale, captchaToken: 'local-boundary' })).toEqual({ ok: true });
  if (finishing) {
    await finishing;
    expect((await db.from('auth_mail_retries').select('id').eq('email', email)).data).toHaveLength(0);
  } else {
    expect(await searchMessages(email)).toHaveLength(0);
    const queued = await db.from('auth_mail_retries').select('id,data').eq('email', email).single();
    expect(queued.error).toBeNull(); expect(queued.data!.data).toMatchObject({ purchase_mail_pending: 'true', locale });
    expect((await db.from('auth_mail_retries').update({ next_attempt_at: new Date(0).toISOString() }).eq('id', queued.data!.id)).error).toBeNull();
    await runAuthMailRetries(db);
    expect((await db.from('auth_mail_retries').select('id').eq('email', email)).data).toHaveLength(1);
    expect(await searchMessages(email)).toHaveLength(0);
    expect((await db.from('payment_transactions').update({ fulfillment_pending: false }).eq('id', tx.data!.id)).error).toBeNull();
    expect((await db.from('auth_mail_retries').update({ next_attempt_at: new Date(0).toISOString() }).eq('id', queued.data!.id)).error).toBeNull();
    await runAuthMailRetries(db);
    expect((await db.from('auth_mail_retries').select('id').eq('email', email)).data).toHaveLength(0);
  }
  const mail = await waitForEmail(email);
  expect(mail.HTML).toContain('Subscription workshop'); expect(mail.HTML).toContain(locale === 'pl' ? '17,00\u00a0zł' : 'PLN\u00a017.00');
  expect(mail.Subject).toBe((locale === 'pl' ? (confirmed ? 'Twój link do logowania' : 'Potwierdź swój email') : (confirmed ? 'Your sign-in link' : 'Confirm your email')) + ': Subscription workshop');
  expect(mail.HTML).toContain(locale === 'pl' ? 'Produkt: ' : 'Product: ');
  expect(mail.HTML).toContain(locale === 'pl' ? 'Kwota: ' : 'Amount: '); expect(await searchMessages(email)).toHaveLength(1);
  await runAuthMailRetries(db);
  expect(await searchMessages(email)).toHaveLength(1);
  const link = new URL(extractMagicLink(mail.HTML!)!); expect(link.pathname).toBe('/auth/callback');
  const buyer = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await buyer.auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: link.searchParams.get('type') as 'signup' | 'magiclink' }); expect(verified.error).toBeNull(); expect(verified.data.user?.id).toBe(uid);
  const access = await buyer.from('user_product_access').select('subscription_id').eq('user_id', uid).eq('product_id', pid); expect(access.error).toBeNull(); expect(access.data).toEqual([{ subscription_id: sub.data!.id }]);
});

it('delivers a generic first link when purchase context is unavailable without claiming access', async () => {
  const email = `generic-first-${crypto.randomUUID()}@example.com`;
  const user = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { purchase_product: 'Previous private workshop', purchase_amount: '999 PLN', event_online_url: 'https://example.com/previous' } }); expect(user.error).toBeNull(); const uid = user.data.user!.id; users.push(uid);
  const product = await db.from('products').insert({ name: 'Unpurchased workshop', slug: `generic-${crypto.randomUUID()}`, price: 17, currency: 'PLN', is_active: true }).select('id,slug').single(); expect(product.error).toBeNull(); products.push(product.data!.id);
  expect(await searchMessages(email)).toHaveLength(0);
  expect(await requestMagicLink({ flow: 'post_checkout', email, productSlug: product.data!.slug, locale: 'pl', captchaToken: 'local-boundary' })).toEqual({ ok: true });
  const mail = await waitForEmail(email);
  for (const text of ['Previous private workshop', '999 PLN', 'https://example.com/previous', 'Unpurchased workshop']) expect(mail.HTML).not.toContain(text);
  expect(extractMagicLink(mail.HTML!)).toBeTruthy();
  expect((await db.from('user_product_access').select('id').eq('user_id', uid)).data).toHaveLength(0);
});
