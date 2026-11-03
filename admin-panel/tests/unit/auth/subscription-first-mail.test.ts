/** First subscription receipt and confirmation are separate from content access. */
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
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
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('subscriptions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
  for (const id of users) await db.auth.admin.deleteUser(id);
  users.length = 0; products.length = 0;
});
it.each([false, true])('delivers the first paid subscription mail and confirms the right buyer: confirmed=%s', async confirmed => {
  const email = `sub-first-${crypto.randomUUID()}@example.com`;
  const user = await db.auth.admin.createUser({ email, email_confirm: confirmed }); expect(user.error).toBeNull(); const uid = user.data.user!.id; users.push(uid);
  const product = await db.from('products').insert({ name: 'Subscription workshop', slug: `sub-first-${crypto.randomUUID()}`, price: 17, currency: 'PLN', product_type: 'subscription', recurring_price: 17, billing_interval: 'month', billing_interval_count: 1, is_active: true }).select('id,slug').single(); expect(product.error).toBeNull(); const pid = product.data!.id; products.push(pid);
  const sub = await db.from('subscriptions').insert({ user_id: uid, product_id: pid, ...recorded.subscription, stripe_subscription_id: `sub_${crypto.randomUUID()}` }).select('id').single(); expect(sub.error).toBeNull();
  const invoiceId = `in_${crypto.randomUUID().replaceAll('-', '')}`;
  const tx = await db.from('payment_transactions').insert({ ...recorded.payment, amount: Number(recorded.payment.amount), session_id: invoiceId, stripe_invoice_id: invoiceId, stripe_payment_intent_id: null, user_id: uid, customer_email: email, product_id: pid, subscription_id: sub.data!.id }).select('id').single(); expect(tx.error).toBeNull();
  expect(await upsertUserProductAccess(db, uid, pid, sub.data!.id)).toEqual({ ok: true });
  expect((await db.from('user_product_access').select('id').eq('user_id', uid).eq('product_id', pid)).data).toHaveLength(confirmed ? 1 : 0);
  expect((await db.from('guest_purchases').select('id').eq('product_id', pid)).data).toHaveLength(0);
  expect(await searchMessages(email)).toHaveLength(0);
  expect(await requestMagicLink({ flow: 'post_checkout', email, productSlug: product.data!.slug, locale: 'pl', captchaToken: 'local-boundary' })).toEqual({ ok: true });
  const mail = await waitForEmail(email);
  expect(mail.HTML).toContain('Subscription workshop'); expect(mail.HTML).toContain('17,00\u00a0zł');
  expect(mail.Subject).toBe(confirmed ? 'Twój link do logowania: Subscription workshop' : 'Potwierdź swój email: Subscription workshop'); expect(await searchMessages(email)).toHaveLength(1);
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
