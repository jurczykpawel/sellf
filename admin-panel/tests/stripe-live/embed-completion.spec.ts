import { assertStripeTransport } from '../helpers/stripe-transport';
import { useSupabaseBuyerEmails as enableSupabaseBuyerEmails } from '../helpers/buyer-email-setting-playwright';
enableSupabaseBuyerEmails();
test.beforeEach(({ page }) => { assertStripeTransport(page); });
/** Real embedded Stripe completion with email collected by Stripe. @see README.md */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import type { AddressInfo } from 'node:net';
import { supabaseAdmin as db, createTestUser } from '../helpers/admin-auth';
import { deleteAuthUserByEmail } from '../helpers/db-cleanup';
import { searchMessages } from '../helpers/mailpit';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

for (const scenario of ['coupon-stripe-email', 'plain-stripe-email', 'plain-stripe-email-pl', 'coupon-known-email', 'coupon-stripe-email-expired', 'coupon-known-email-expired']) {
  test(`embed completion ${scenario} @J12`, async ({ page, baseURL }) => {
    expect(process.env.STRIPE_LIVE_E2E).toBe('1');
    expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
    const seller = await createTestUser('embed-live-seller');
    const slug = `embed-live-${randomUUID()}`;
    const email = `${slug}@example.com`;
    const polish = scenario.endsWith('-pl');
    const coupon = scenario.startsWith('coupon');
    const knownEmail = scenario.includes('known-email');
    let productId = '', couponId = '', licenseKid = '', endpointId = '';
    const sessions: string[] = [];
    let html = '';
    const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await db.from('seller_embed_settings').upsert({ seller_id: seller.userId, allowed_embed_origins: [origin] })).error).toBeNull();
      if (polish) {
        const pair = generateSellerKeypair(); licenseKid = pair.kid;
        await storeSellerKey(db, { sellerId: seller.userId, ...pair, custody: 'managed' });
      }
      const product = await db.from('products').insert({ slug, name: 'Embedded payment', price: 20, currency: 'USD', vat_exempt: true,
        is_active: true, embed_enabled: true, seller_id: seller.userId, ...(polish ? { issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: 30 } : {}) }).select('id').single();
      expect(product.error).toBeNull(); productId = product.data!.id;
      const endpoint = await db.from('webhook_endpoints').insert({ url: `${process.env.STRIPE_LIVE_RECEIVER_URL}/${slug}`, secret: randomUUID(), events: ['purchase.completed'], product_filter_mode: 'selected', is_active: true }).select('id').single();
      expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
      expect((await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: productId })).error).toBeNull();
      const code = `EMBED-${randomUUID()}`.toUpperCase();
      if (coupon) {
        const result = await db.from('coupons').insert({ code, discount_type: 'percentage', discount_value: 10,
          usage_limit_per_user: 1, usage_limit_global: 5, allowed_product_ids: [productId] }).select('id').single();
        expect(result.error).toBeNull(); couponId = result.data!.id;
      }
      html = `<!doctype html><html lang="${polish ? 'pl' : 'en'}"><body><div data-locale="${polish ? 'pl' : 'en'}" data-sellf-embed data-product-slug="${slug}" ${knownEmail ? `data-email="${email}"` : ''} ${coupon ? `data-coupon="${code}"` : ''}></div><script src="${baseURL}/embed/v1/checkout.js"></script></body></html>`;
      page.on('response', async response => {
        if (new URL(response.url()).pathname === '/api/embed/checkout-session' && response.ok()) {
          const body = await response.json(); if (body.sessionId) sessions.push(body.sessionId);
        }
      });
      await page.goto(origin);
      await expect.poll(() => sessions.length).toBeGreaterThan(0);
      if (coupon) {
        await expect(page.locator('.sellf-coupon input[name="coupon"]')).toHaveValue(code);
        await expect.poll(() => sessions.length).toBe(1);
      }
      const sessionId = sessions.at(-1)!;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (polish) { expect(session.metadata?.locale).toBe('pl'); expect(session.return_url).toContain('/pl/p/'); }
      expect(session.customer_email).toBe(knownEmail ? email : null);
      expect(session.amount_total).toBe(coupon ? 1800 : 2000);
      if (scenario.endsWith('-expired')) {
        expect((await db.from('coupons').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', couponId)).error).toBeNull();
      }
      const checkout = page.frameLocator('iframe[name="embedded-checkout"]');
      if (!knownEmail) await checkout.locator('input[name="email"]').fill(email);
      await checkout.getByTestId('card-accordion-item').click({ timeout: 60000 });
      await checkout.locator('input[name="cardNumber"]').fill('4242424242424242');
      await checkout.locator('input[name="cardExpiry"]').fill('1234');
      await checkout.locator('input[name="cardCvc"]').fill('123');
      const name = checkout.locator('input[name="billingName"]');
      if (await name.isVisible()) await name.fill('Embed Buyer');
      const postal = checkout.locator('input[name="billingPostalCode"]');
      if (await postal.isVisible()) await postal.fill('10001');
      await checkout.getByTestId('hosted-payment-submit-button').click();
      await page.waitForURL(/payment-status.*session_id=/, { timeout: 120000 });
      await expect.poll(async () => {
        const result = await db.from('payment_transactions').select('status').eq('session_id', sessionId);
        expect(result.error).toBeNull(); return result.data?.map(row => row.status);
      }, { timeout: 90000 }).toEqual(['completed']);
      const deliveries = () => readFileSync(`${process.env.STRIPE_LIVE_ARTIFACTS}/deliveries.jsonl`, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.path === `/${slug}`);
      await expect.poll(() => deliveries().length, { timeout: 90000 }).toBe(1);
      expect(deliveries()[0].body.data.customer.locale).toBe(polish ? 'pl' : 'en');
      const tx = await db.from('payment_transactions').select('*').eq('session_id', sessionId).single();
      expect(tx.data).toMatchObject({ status: 'completed', customer_email: email, amount: coupon ? 1800 : 2000, currency: 'USD' });
      await expect.poll(async () => (await db.from('guest_purchases').select('customer_email').eq('session_id', sessionId)).data).toEqual([{ customer_email: email }]);
      await expect(page.getByText(/order details need review|Payment Failed/i)).toHaveCount(0);
      await expect(page.getByText(polish ? /Dostęp|Płatność|email|e-mail/i : /Access granted|You now have access|Payment successful|Check your email|magic link/i).first()).toBeVisible({ timeout: 60000 });
      if (polish) {
        expect(new URL(page.url()).pathname).toBe(`/pl/p/${slug}/payment-status`);
        await expect.poll(async () => {
          const result = await page.request.get('/api/cron?job=auth-mail-retry', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
          expect(result.status()).toBe(200);
          return (await searchMessages(email)).map(message => message.Subject);
        }, { timeout: 180000, intervals: [5000] }).toEqual(expect.arrayContaining([
          'Twój klucz licencyjny: Embedded payment', 'Potwierdź swój email: Embedded payment',
        ]));
      }
      if (coupon) {
        expect((await db.from('coupons').select('current_usage_count').eq('id', couponId).single()).data?.current_usage_count).toBe(1);
        expect((await db.from('coupon_redemptions').select('transaction_id').eq('coupon_id', couponId)).data).toEqual([{ transaction_id: tx.data!.id }]);
        const second = await db.rpc('verify_coupon', { code_param: code, product_id_param: productId, customer_email_param: email, currency_param: 'USD' });
        expect(second.data).toMatchObject({ valid: false });
      }
    } finally {
      if (endpointId) await db.from('webhook_endpoints').delete().eq('id', endpointId);
      const transactions = await db.from('payment_transactions').select('*').eq('product_id', productId);
      writeFileSync(`${process.env.STRIPE_LIVE_ARTIFACTS}/${slug}.json`, JSON.stringify({ scenario, sessions, transactions: transactions.data }, null, 2));
      for (const id of sessions) if ((await stripe.checkout.sessions.retrieve(id)).status === 'open') await stripe.checkout.sessions.expire(id);
      if (polish) {
        await db.from('auth_mail_retries').delete().eq('email', email);
        await db.from('issued_licenses').delete().eq('product_id', productId);
        if (licenseKid) await db.from('seller_license_keys').delete().eq('kid', licenseKid);
      }
      for (const table of ['coupon_redemptions', 'coupon_reservations']) if (couponId) await db.from(table).delete().eq('coupon_id', couponId);
      for (const table of ['guest_purchases', 'user_product_access', 'payment_transactions']) if (productId) await db.from(table).delete().eq('product_id', productId);
      if (couponId) await db.from('coupons').delete().eq('id', couponId);
      await db.from('embed_checkout_log').delete().eq('product_slug', slug);
      if (productId) await db.from('products').delete().eq('id', productId);
      await db.from('seller_embed_settings').delete().eq('seller_id', seller.userId);
      await seller.cleanup();
      await deleteAuthUserByEmail(db, email);
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
