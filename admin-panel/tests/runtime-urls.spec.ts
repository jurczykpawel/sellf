/** Regression against the actual placeholder-built production artifact. */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { solveChallenge } from 'altcha-lib/v1';
import Stripe from 'stripe';
import type { APIRequestContext } from '@playwright/test';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';
const origin = 'http://localhost:3777';
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const marker = `runtime-url-${Date.now()}`;
const emails: string[] = [];
const productIds: string[] = [];
// Production rejects provider=none: exercise its real ALTCHA and nonce gate.
async function captcha(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/captcha/challenge');
  expect(response.ok()).toBeTruthy();
  const challenge = await response.json();
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  expect(solution).toBeTruthy();
  return Buffer.from(JSON.stringify({ ...challenge, number: solution!.number, took: solution!.took })).toString('base64');
}
test.afterAll(async () => {
  for (const id of productIds) await admin.from('products').delete().eq('id', id);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) if (emails.includes(user.email || '')) await admin.auth.admin.deleteUser(user.id);
});
for (const flow of ['login', 'free_product'] as const) {
  test(`${flow}: email contains runtime callback and authenticates`, async ({ request, page }) => {
    const email = `${marker}-${flow}@example.com`;
    emails.push(email);
    let productSlug: string | undefined;
    if (flow === 'free_product') {
      productSlug = `${marker}-free`;
      const { data, error } = await admin.from('products').insert({
        name: 'Runtime URL free regression', slug: productSlug, price: 0, currency: 'USD', is_active: true,
      }).select('id').single();
      expect(error).toBeNull(); productIds.push(data!.id);
    }
    const response = await request.post('/api/auth/magic-link', {
      data: { email, flow, productSlug, captchaToken: await captcha(request) },
    });
    expect(response.status(), await response.text()).toBe(200);
    const message = await waitForEmail(email, { timeout: 30000 });
    const link = extractMagicLink(message.HTML || message.Text || '');
    expect(link, 'Use the delivered email URL without repairing its host or path').toBeTruthy();
    const url = new URL(link!);
    expect(url.origin).toBe(origin); expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('token_hash')).toBeTruthy();
    await page.goto(link!);
    await expect(page).toHaveURL(flow === 'login' ? /\/my-products/ : new RegExp(`/p/${productSlug}`));
    expect((await page.context().cookies()).some(cookie => cookie.name.includes('auth-token'))).toBeTruthy();
    if (productSlug) {
      const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const user = users.users.find(item => item.email === email)!;
      const { data: access } = await admin.from('user_product_access').select('id').eq('user_id', user.id).eq('product_id', productIds.at(-1)!);
      expect(access?.length).toBe(1);
    }
  });
}
test('sitemap and metadata use runtime origin', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBeTruthy(); expect(await sitemap.text()).toContain(`${origin}/en/about`);
  expect(await sitemap.text()).not.toMatch(/placeholder|your-domain/);
  const about = await request.get('/en/about');
  expect(await about.text()).toContain(`${origin}/api/og/about`);
  expect(await about.text()).not.toContain('placeholder.example.com');
});

test('embed session return_url uses runtime origin', async ({ request }) => {
  const key = process.env.STRIPE_SECRET_KEY || '';
  expect(key.startsWith('sk_test_') || key.startsWith('rk_test_'), 'This regression requires a test-mode Stripe key').toBeTruthy();
  const stripe = new Stripe(key);
  const sellerEmail = `${marker}-seller@example.com`;
  emails.push(sellerEmail);
  const { data: seller, error: sellerError } = await admin.auth.admin.createUser({ email: sellerEmail, email_confirm: true });
  expect(sellerError).toBeNull();
  const { error: embedError } = await admin.from('seller_embed_settings').upsert({ seller_id: seller.user!.id, allowed_embed_origins: [origin] });
  expect(embedError).toBeNull();
  const slug = `${marker}-paid`;
  const { data, error } = await admin.from('products').insert({
    name: 'Runtime URL embed regression', slug, price: 10, currency: 'USD', is_active: true, embed_enabled: true, seller_id: seller.user!.id,
  }).select('id').single();
  expect(error).toBeNull(); productIds.push(data!.id);
  const response = await request.post('/api/embed/checkout-session', {
    headers: { origin },
    data: { productSlug: slug, turnstileToken: await captcha(request) },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.kind).toBe('paid');
  const session = await stripe.checkout.sessions.retrieve(body.sessionId);
  try {
    expect(new URL(session.return_url!).origin).toBe(origin);
    expect(new URL(session.return_url!).pathname).toBe(`/p/${slug}/payment-status`);
  } finally {
    await stripe.checkout.sessions.expire(session.id);
    await admin.from('payment_transactions').delete().eq('session_id', session.id).eq('status', 'pending');
  }
});
