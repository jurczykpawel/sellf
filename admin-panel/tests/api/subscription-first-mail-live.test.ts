/** Opt-in real Stripe checkout -> local webhook -> first Auth email, without a browser. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { solveChallenge } from 'altcha-lib/v1';
import { API_URL, supabaseAdmin } from './setup';
import { extractMagicLink, searchMessages, waitForEmail } from '../helpers/mailpit';
import { deleteAuthUserByEmail } from '../helpers/db-cleanup';

describe.runIf(process.env.STRIPE_LIVE_API === '1')('real subscription first email', () => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const db = supabaseAdmin();
  async function captcha(): Promise<string> {
    const challenge = await (await fetch(`${API_URL}/api/captcha/challenge`)).json();
    const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise; expect(solution).toBeTruthy();
    return Buffer.from(JSON.stringify({ ...challenge, number: solution!.number, took: solution!.took })).toString('base64');
  }
  async function completeCheckout(sessionId: string, email: string, amount: number): Promise<Stripe.Checkout.Session> {
    await stripe.rawRequest('GET', `/v1/payment_pages/${sessionId}`);
    const method = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' }, billing_details: { email, name: 'First Mail Buyer' } });
    await stripe.rawRequest('POST', `/v1/payment_pages/${sessionId}/confirm`, { payment_method: method.id, expected_amount: amount });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    expect(session.status).toBe('complete'); expect(session.amount_total).toBe(amount);
    return session;
  }
  async function deliverEvent(type: Stripe.Event.Type, id: string): Promise<void> {
    let event: Stripe.Event | undefined;
    await expect.poll(async () => {
      event = (await stripe.events.list({ type, limit: 100 })).data.find(item => item.data.object.id === id);
      return !!event;
    }, { timeout: 30000 }).toBe(true);
    const payload = JSON.stringify(event);
    const response = await fetch(`${API_URL}/api/webhooks/stripe`, { method: 'POST', body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! }) } });
    expect(response.status, await response.text()).toBe(200);
  }
  async function productMail(kind: 'coupon' | 'variant' | 'bundle' | 'event' | 'transfer'): Promise<void> {
    const slug = `matrix-mail-${randomUUID()}`, email = `${slug}@example.com`;
    const ids: string[] = [];
    let couponId: string | undefined, couponCode: string | undefined, groupId: string | undefined;
    let sessionId: string | undefined, customerId: string | undefined;
    let bankConfig: Record<string, unknown> | undefined;
    async function insert(table: string, value: object) {
      const result = await db.from(table).insert(value).select().single(); if (result.error) throw result.error; return result.data!;
    }
    async function post(path: string, body: object) {
      const response = await fetch(`${API_URL}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      const text = await response.text(); expect(response.status, text).toBe(200); return JSON.parse(text);
    }
    try {
      expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
      expect(new URL(process.env.SUPABASE_URL!).hostname).toBe('127.0.0.1');
      const product = await insert('products', { slug, name: `First receipt ${kind}`, price: 17, currency: 'PLN', is_active: true, vat_exempt: true, is_bundle: kind === 'bundle', event_mode: kind === 'event' }); ids.push(product.id);
      if (kind === 'variant' || kind === 'bundle') {
        const other = await insert('products', { slug: `${slug}-other`, name: 'Other course', price: 29, currency: 'PLN', is_active: true, vat_exempt: true }); ids.push(other.id);
        if (kind === 'bundle') await insert('bundle_items', { bundle_product_id: product.id, component_product_id: other.id, display_order: 0 });
        else {
          const group = await insert('variant_groups', { name: 'First receipt plans', slug, is_active: true }); groupId = group.id;
          await insert('product_variant_groups', { group_id: group.id, product_id: product.id, variant_name: 'Selected plan', display_order: 0 });
          await insert('product_variant_groups', { group_id: group.id, product_id: other.id, variant_name: 'Other plan', display_order: 1 });
        }
      }
      let eventSessionId: string | undefined;
      if (kind === 'event') {
        const event = await insert('product_sessions', { product_id: product.id, starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', title: 'June workshop', capacity: 20, online_url: 'https://example.com/first-mail-room' }); eventSessionId = event.id;
        await insert('product_price_tiers', { session_id: event.id, price: 17, sort: 0 });
      }
      expect(await searchMessages(email)).toHaveLength(0);
      if (kind === 'coupon') {
        const coupon = await insert('coupons', { code: `FREE-${randomUUID().slice(0, 8)}`.toUpperCase(), discount_type: 'percentage', discount_value: 100, is_active: true }); couponId = coupon.id; couponCode = coupon.code;
      } else if (kind === 'transfer') {
        bankConfig = (await db.from('bank_transfer_config').select('*').single()).data!;
        expect((await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Local workshop', bank_account_number: 'PL61109010140000071219812874', bank_transfer_grant_access_on_placement: true }).eq('id', true)).error).toBeNull();
        expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false, bank_transfer_for: ['person'] }] } }).eq('id', product.id)).error).toBeNull();
        expect(await post('/api/orders/bank-transfer', { productId: product.id, email, locale: 'pl', termsAccepted: true, captchaToken: await captcha(), moduleValues: { buyer: { type: 'person', first_name: 'First', last_name: 'Buyer', email } } })).toMatchObject({ amount: 1700, currency: 'PLN' });
      } else {
        const checkout = await post('/api/create-payment-intent', { productId: product.id, email, locale: 'pl', termsAccepted: true, ...(eventSessionId ? { sessionId: eventSessionId } : {}) }); sessionId = checkout.checkoutSessionId;
        const session = await completeCheckout(sessionId!, email, 1700);
        customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        await deliverEvent('checkout.session.completed', session.id);
        const tx = await db.from('payment_transactions').select('amount,status').eq('product_id', product.id).single(); expect(tx.error).toBeNull(); expect(tx.data).toMatchObject({ amount: 1700, status: 'completed' });
      }
      if (kind !== 'transfer') await post('/api/auth/magic-link', { email, flow: kind === 'coupon' ? 'free_product' : 'post_checkout', productSlug: slug, locale: 'pl', captchaToken: await captcha(), ...(couponCode ? { couponCode } : {}) });
      const mail = await waitForEmail(email, { timeout: 20000 }); expect(await searchMessages(email)).toHaveLength(1);
      if (kind !== 'coupon') { expect(mail.HTML).toContain(`First receipt ${kind}`); expect(mail.HTML).toContain('17,00\u00a0zł'); }
      else expect((await db.from('payment_transactions').select('id').eq('product_id', product.id)).data).toHaveLength(0);
      if (kind === 'variant') expect(mail.HTML).not.toContain('Other course');
      if (kind === 'event') { expect(mail.HTML).toContain('2099'); expect(mail.HTML).toContain('https://example.com/first-mail-room'); }
      if (kind === 'transfer') { expect(mail.HTML).toContain('Dane do przelewu'); expect(mail.HTML).toContain('PL61 1090 1014 0000 0712 1981 2874'); }
      const link = extractMagicLink(mail.HTML!); expect(link).toBeTruthy();
      const callback = await fetch(link!, { redirect: 'manual' }); expect(callback.status).toBe(307);
      const cookie = callback.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); expect(cookie).toContain('auth-token');
      const destination = await fetch(callback.headers.get('location')!, { redirect: 'manual', headers: { cookie } }); expect(destination.status).toBe(307); expect(destination.headers.get('location')).toContain(`/p/${slug}`);
      const uid = (await db.rpc('find_user_id_by_email', { p_email: email })).data as string; expect(uid).toBeTruthy();
      const grants = await db.from('user_product_access').select('product_id').eq('user_id', uid).in('product_id', ids); expect(grants.error).toBeNull();
      expect(new Set(grants.data!.map(row => row.product_id))).toEqual(new Set(kind === 'bundle' ? ids : [product.id]));
      if (couponId) expect((await db.from('coupon_redemptions').select('id').eq('coupon_id', couponId)).data).toHaveLength(1);
      if (kind === 'transfer') expect((await db.from('payment_transactions').select('status').eq('product_id', product.id).single()).data?.status).toBe('awaiting_payment');
    } finally {
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId); if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        if (customerId) await stripe.customers.del(customerId);
      }
      if (groupId) await db.from('variant_groups').delete().eq('id', groupId);
      await db.from('bundle_items').delete().in('bundle_product_id', ids);
      if (couponId) for (const table of ['coupon_redemptions', 'coupon_reservations']) await db.from(table).delete().eq('coupon_id', couponId);
      for (const table of ['guest_purchases', 'user_product_access', 'payment_transactions', 'products']) {
        const result = await db.from(table).delete().in(table === 'products' ? 'id' : 'product_id', ids); expect(result.error).toBeNull();
      }
      if (couponId) await db.from('coupons').delete().eq('id', couponId);
      if (bankConfig) expect((await db.from('bank_transfer_config').update(bankConfig).eq('id', true)).error).toBeNull();
      await deleteAuthUserByEmail(db, email);
    }
  }
  it('full coupon first invitation redeems access @J143', () => productMail('coupon'), 120000);
  it('variant first mail identifies only selected plan @J144', () => productMail('variant'), 120000);
  it('bundle first mail opens included course @J145', () => productMail('bundle'), 120000);
  it('event first mail includes session and opens access @J146', () => productMail('event'), 120000);
  it('transfer first mail includes due amount and opens early access @J147', () => productMail('transfer'), 120000);
  it.each(['guest', 'signed-in', 'trial'])('delivers the first receipt and confirms access: %s', async kind => {
    expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
    expect(new URL(process.env.SUPABASE_URL!).hostname).toBe('127.0.0.1');
    const slug = `first-api-${randomUUID()}`, email = `${slug}@example.com`, password = 'FirstMail123!';
    let productId: string | undefined, sessionId: string | undefined, buyerId: string | undefined;
    let cookie = '';
    async function post(path: string, body: unknown, authenticated = false) {
      return fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) }, body: JSON.stringify(body) });
    }
    try {
      if (kind === 'signed-in') {
        const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull(); buyerId = created.data.user!.id;
        const client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
        const signIn = await client.auth.signInWithPassword({ email, password }); expect(signIn.error).toBeNull();
        const key = `sb-${new URL(process.env.SUPABASE_URL!).hostname.split('.')[0]}-auth-token`;
        const value = `base64-${Buffer.from(JSON.stringify(signIn.data.session)).toString('base64url')}`;
        cookie = value.length <= 3180 ? `${key}=${value}` : Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => `${key}.${index}=${value.slice(index * 3180, (index + 1) * 3180)}`).join('; ');
      }
      const product = await db.from('products').insert({ name: 'Subscription first receipt', slug, price: 17, currency: 'PLN', is_active: true, vat_exempt: true, product_type: 'subscription', recurring_price: 17, billing_interval: 'month', billing_interval_count: 1, trial_days: kind === 'trial' ? 7 : null }).select('id').single();
      expect(product.error).toBeNull(); productId = product.data!.id;
      const checkout = await post('/api/create-payment-intent', { productId, email, locale: 'pl', termsAccepted: true }, kind === 'signed-in');
      const checkoutBody = await checkout.text(); expect(checkout.status, checkoutBody).toBe(200);
      sessionId = JSON.parse(checkoutBody).checkoutSessionId; expect(sessionId).toMatch(/^cs_test_/);
      // Complete the real session using the provider's CLI fixture protocol.
      const session = await completeCheckout(sessionId!, email, kind === 'trial' ? 0 : 1700);
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription!.id;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice!.id;
      for (const [type, id] of [['customer.subscription.created', subscriptionId], ['invoice.paid', invoiceId]] as const) {
        await deliverEvent(type, id);
      }
      const transaction = await db.from('payment_transactions').select('amount,status,session_id,subscription_id').eq('product_id', productId).single();
      expect(transaction.error).toBeNull(); expect(transaction.data).toMatchObject({ amount: kind === 'trial' ? 0 : 1700, status: 'completed', session_id: invoiceId });
      const before = await db.from('user_product_access').select('id').eq('product_id', productId);
      expect(before.data).toHaveLength(kind === 'signed-in' ? 1 : 0);
      expect((await db.from('guest_purchases').select('id').eq('product_id', productId)).data).toHaveLength(0);
      const verified = await post('/api/verify-payment', { session_id: sessionId }, kind === 'signed-in');
      expect(verified.status).toBe(200);
      expect(await verified.json()).toMatchObject(kind === 'signed-in' ? { scenario: 'subscription', access_granted: true } : { scenario: 'subscription_guest', send_magic_link: true, requires_login: true });
      expect(await searchMessages(email)).toHaveLength(0);
      const captchaToken = await captcha();
      const delivered = await post('/api/auth/magic-link', { flow: 'post_checkout', productSlug: slug, email, locale: 'pl', captchaToken });
      const deliveryBody = await delivered.text();
      expect(delivered.status, `${deliveryBody}; mailbox=${(await searchMessages(email)).length}`).toBe(200);
      const mail = await waitForEmail(email); expect(await searchMessages(email)).toHaveLength(1);
      expect(mail.HTML).toContain('Subscription first receipt'); expect(mail.HTML).toContain(kind === 'trial' ? '0,00\u00a0zł' : '17,00\u00a0zł');
      const link = extractMagicLink(mail.HTML!); expect(link).toBeTruthy();
      const callback = await fetch(link!, { redirect: 'manual' }); expect(callback.status).toBe(307);
      const callbackCookie = callback.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      expect(callbackCookie).toContain('auth-token');
      const destination = await fetch(callback.headers.get('location')!, { redirect: 'manual', headers: { cookie: callbackCookie } });
      expect(destination.status).toBe(307); expect(destination.headers.get('location')).toContain(`/p/${slug}`);
      const user = await db.rpc('find_user_id_by_email', { p_email: email }); expect(user.data).toBeTruthy(); buyerId = user.data as string;
      const access = await db.from('user_product_access').select('user_id,subscription_id').eq('product_id', productId);
      expect(access.data).toEqual([{ user_id: buyerId, subscription_id: transaction.data!.subscription_id }]);
    } finally {
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.subscription) await stripe.subscriptions.cancel(typeof session.subscription === 'string' ? session.subscription : session.subscription.id);
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        if (session.customer) await stripe.customers.del(typeof session.customer === 'string' ? session.customer : session.customer.id);
      }
      if (productId) {
        const product = await db.from('products').select('stripe_price_id,stripe_product_id').eq('id', productId).single();
        const price = product.data?.stripe_price_id ? await stripe.prices.retrieve(product.data.stripe_price_id) : null;
        const stripeProductId = product.data?.stripe_product_id || (typeof price?.product === 'string' ? price.product : price?.product.id);
        if (stripeProductId) await stripe.products.update(stripeProductId, { default_price: '', active: false });
        if (price) await stripe.prices.update(price.id, { active: false });
        for (const table of ['guest_purchases', 'user_product_access', 'payment_transactions', 'subscriptions', 'products']) {
          const removed = await db.from(table).delete().eq(table === 'products' ? 'id' : 'product_id', productId);
          expect(removed.error).toBeNull();
        }
      }
      await deleteAuthUserByEmail(db, email);
    }
  }, 120000);
});
