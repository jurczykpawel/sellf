/**
 * Login wall E2E — covers the per-product handoff redirect chain and
 * the loader script served at /api/loginwall/login.js.
 *
 * Strategy:
 *  - Create a regular (non-admin) test user and a fresh product.
 *  - Drive the protect route without a session, without access, and with
 *    access; assert the redirect targets directly. The customer page that
 *    finally consumes the token is hosted on an arbitrary external origin
 *    in production; the email return test serves a local browser fixture.
 *  - Hit /api/loginwall/login.js directly to confirm the JS payload.
 */
import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';

test.describe.configure({ mode: 'serial' });

const RUN_ID = `lw-e2e-${Date.now()}`;
const CUSTOMER_ORIGIN = 'https://customer.example';
const CUSTOMER_PAGE = `${CUSTOMER_ORIGIN}/${RUN_ID}`;

let testUser: { id: string; email: string; password: string };
let testSeller: { id: string; email: string };
let testProduct: { id: string; slug: string };

test.beforeAll(async () => {
  const email = `${RUN_ID}@example.com`;
  const password = 'password123';
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !user) throw new Error(`createUser failed: ${userErr?.message}`);
  testUser = { id: user.id, email, password };

  const sellerEmail = `${RUN_ID}-seller@example.com`;
  const { data: { user: sellerUser }, error: sellerErr } = await supabaseAdmin.auth.admin.createUser({
    email: sellerEmail,
    password,
    email_confirm: true,
  });
  if (sellerErr || !sellerUser) throw new Error(`createSellerUser failed: ${sellerErr?.message}`);
  testSeller = { id: sellerUser.id, email: sellerEmail };

  const { error: settingsErr } = await supabaseAdmin
    .schema('public')
    .from('seller_embed_settings')
    .upsert({
      seller_id: sellerUser.id,
      allowed_embed_origins: [CUSTOMER_ORIGIN],
    });
  if (settingsErr) throw new Error(`upsert seller_embed_settings failed: ${settingsErr.message}`);

  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Loginwall E2E ${RUN_ID}`,
      slug: RUN_ID,
      price: 0,
      currency: 'USD',
      is_active: true,
      seller_id: sellerUser.id,
    })
    .select('id, slug')
    .single();
  if (productErr || !product) throw new Error(`create product failed: ${productErr?.message}`);
  testProduct = { id: product.id, slug: product.slug };
});

test.afterAll(async () => {
  if (testProduct?.id) {
    await supabaseAdmin.from('user_product_access').delete().eq('product_id', testProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
  }
  if (testSeller?.id) {
    await supabaseAdmin
      .schema('public')
      .from('seller_embed_settings')
      .delete()
      .eq('seller_id', testSeller.id);
    await supabaseAdmin.auth.admin.deleteUser(testSeller.id);
  }
  if (testUser?.id) {
    await supabaseAdmin.auth.admin.deleteUser(testUser.id);
  }
});

test.describe('Loginwall flow', () => {
  test('GET /api/loginwall/login.js?id=<uuid> returns script body', async ({ request }) => {
    const res = await request.get(`/api/loginwall/login.js?id=${testProduct.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toContain('application/javascript');
    const body = await res.text();
    expect(body).toContain(testProduct.id);
    expect(body).toContain('_sf_token');
    expect(body).toContain('loginwall/protect');
  });

  test('GET /api/loginwall/login.js with bad id is 400', async ({ request }) => {
    const res = await request.get('/api/loginwall/login.js?id=not-a-uuid');
    expect(res.status()).toBe(400);
  });

  test('GET /loginwall/protect without a session redirects to /login', async ({ request }) => {
    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('redirect_to=');
  });

  test('email sign-in returns the buyer to the protected customer page', async ({ page, request }) => {
    const access = await supabaseAdmin.from('user_product_access').insert({
      user_id: testUser.id,
      product_id: testProduct.id,
      access_expires_at: null,
    });
    expect(access.error).toBeNull();
    try {
      await page.route('https://customer.example/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>customer</body></html>',
      }));
      await acceptAllCookies(page);
      const returnPath = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
      await page.goto(returnPath);
      await expect(page).toHaveURL(/\/login\?redirect_to=/);
      const loginUrl = new URL(page.url());
      expect(loginUrl.searchParams.get('redirect_to')).toBe(returnPath);
      const sent = await request.post('/api/auth/magic-link', {
        data: { email: testUser.email, flow: 'login', redirectTo: loginUrl.searchParams.get('redirect_to'), captchaToken: 'test-token' },
      });
      expect(await sent.json()).toEqual({ ok: true });
      const message = await waitForEmail(testUser.email);
      const link = extractMagicLink(message.HTML || message.Text || '');
      expect(link).not.toBeNull();
      expect(new URL(link!).searchParams.get('redirect_to')).toBe(returnPath);
      // Follow the real handoff with browser cookies before opening the routed customer fixture.
      const callback = await page.context().request.get(link!, { maxRedirects: 0 });
      expect(callback.status()).toBe(307);
      const protectUrl = callback.headers()['location'];
      expect(new URL(protectUrl).pathname + new URL(protectUrl).search).toBe(returnPath);
      const protectedPage = await page.context().request.get(protectUrl, { maxRedirects: 0 });
      expect(protectedPage.status()).toBe(307);
      const customerUrl = protectedPage.headers()['location'];
      expect(customerUrl.startsWith(`${CUSTOMER_PAGE}#_sf_token=`)).toBe(true);
      await page.goto(customerUrl);
      await expect(page).toHaveURL(new RegExp(`^${CUSTOMER_PAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#_sf_token=[A-Za-z0-9._-]+$`));
      await expect(page.getByText('customer', { exact: true })).toBeVisible();
    } finally {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id).eq('product_id', testProduct.id);
    }
  });

  test('GET /loginwall/protect with session but no access redirects to /p/{slug}', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);

    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id);

    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(`/p/${testProduct.slug}`);
  });

  test('GET /loginwall/protect with session + access redirects back with _sf_token in the URL fragment', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);

    await supabaseAdmin.from('user_product_access').insert({
      user_id: testUser.id,
      product_id: testProduct.id,
      access_expires_at: null,
    });

    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location.startsWith(CUSTOMER_PAGE)).toBe(true);
    expect(location).toMatch(/#_sf_token=[A-Za-z0-9._-]+$/);
    expect(location).not.toMatch(/[?&]_sf_token=/);

    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id);
  });

  test('GET /loginwall/protect rejects a redirect host that is not in the seller allowlist', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);

    await supabaseAdmin.from('user_product_access').insert({
      user_id: testUser.id,
      product_id: testProduct.id,
      access_expires_at: null,
    });

    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent('https://not-allowed.example.com/blocked')}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);

    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id);
  });

  test('GET /loginwall/protect rejects an internal-host redirect target', async ({ request }) => {
    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent('http://169.254.169.254/meta')}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });

  test('GET /loginwall/protect rejects a javascript: redirect target', async ({ request }) => {
    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent('javascript:alert(1)')}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });
});
