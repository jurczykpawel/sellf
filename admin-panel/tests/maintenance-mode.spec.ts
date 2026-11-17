import { test, expect } from '@playwright/test';
import { createTestUser, loginAsAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { clearPaidCheckout, paidCheckoutEvent, sendStripeEvent } from './helpers/stripe-test-events';
import type Stripe from 'stripe';

/**
 * Maintenance mode end to end, against the running app:
 * - J650: the admin switches it on in Settings → System; the shop, the checkout API and the embed
 *   checkout answer 503 with the maintenance page / code, the admin panel keeps working, and
 *   switching it off reopens the shop. Both changes are audited.
 * - J651: a purchase paid before the break is completed by the Stripe webhook during the break.
 * - J655: a signed-in buyer gets no new free access during the break; the free-product link of a
 *   request made before the break still grants it.
 *
 * Serial and self-restoring: the switch is global, so every test turns it off again.
 * @see src/proxy.ts
 * @see src/lib/maintenance/
 */

test.describe('Maintenance mode', () => {
  test.describe.configure({ mode: 'serial' });

  let productId = '';
  let productSlug = '';
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  const providerSessions: string[] = [];

  const setMaintenance = async (enabled: boolean, message: string | null = null) => {
    const { error } = await supabaseAdmin.rpc('set_maintenance_mode', {
      p_enabled: enabled, p_message: message as string, p_expected_end_at: null as unknown as string, p_performed_by: admin.userId, p_details: { auth: 'e2e' },
    });
    if (error) throw error;
  };

  test.beforeAll(async () => {
    admin = await createTestUser('maintenance-admin');
    await supabaseAdmin.from('admin_users').insert({ user_id: admin.userId });
    productSlug = `maintenance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabaseAdmin.from('products')
      .insert({ name: 'Maintenance Course', slug: productSlug, price: 49.99, currency: 'USD', is_active: true, description: 'Maintenance mode e2e' })
      .select('id').single();
    if (error) throw error;
    productId = data.id;
  });

  test.afterAll(async () => {
    await setMaintenance(false);
    for (const id of providerSessions) await clearPaidCheckout(id);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
    await supabaseAdmin.from('products').delete().eq('id', productId);
    await supabaseAdmin.from('audit_log').delete().eq('performed_by', admin.userId);
    await supabaseAdmin.from('admin_users').delete().eq('user_id', admin.userId);
    await admin.cleanup();
  });

  test('admin turns it on in the panel; nobody can start a purchase; turning it off reopens the shop @J650', async ({ page, request, browser }) => {
    const since = new Date().toISOString();
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/settings?tab=system');
    const section = page.getByTestId('maintenance-settings');
    await expect(section.getByTestId('maintenance-status')).toHaveText('Wyłączona: sklep działa.');
    await section.getByLabel('Komunikat dla odwiedzających').fill('Inwentaryzacja, wracamy o 14:00');
    await section.getByRole('button', { name: 'Włącz przerwę w działaniu' }).click();
    await expect(section.getByTestId('maintenance-status')).toHaveText(/^Włączona: tutaj w panelu/);
    await page.screenshot({ path: 'test-results/maintenance-panel-on.png', fullPage: true });

    // A visitor (no session) sees the maintenance page instead of the product and the checkout.
    await expect.poll(async () => (await request.get(`/pl/p/${productSlug}`)).status(), { timeout: 15000 }).toBe(503);
    const pageResponse = await request.get(`/pl/p/${productSlug}`);
    expect(pageResponse.headers()['retry-after']).toBe('300');
    const html = await pageResponse.text();
    expect(html).toContain('Przerwa techniczna');
    expect(html).toContain('Inwentaryzacja, wracamy o 14:00');
    expect((await request.get(`/checkout/${productSlug}`)).status()).toBe(503);

    const visitor = await browser.newPage();
    await visitor.goto(`/pl/p/${productSlug}`);
    await expect(visitor.getByRole('heading', { name: 'Przerwa techniczna' })).toBeVisible();
    await visitor.screenshot({ path: 'test-results/maintenance-page-pl.png', fullPage: true });
    await visitor.close();

    // No new payment can start: storefront checkout, embed checkout, order payment.
    for (const path of ['/api/create-payment-intent', '/api/embed/checkout-session', '/api/orders/00000000-0000-4000-8000-000000000000/pay']) {
      const response = await request.post(path, { data: { productId, productSlug }, headers: { origin: 'https://seller.example' } });
      expect(response.status(), path).toBe(503);
      expect(await response.json(), path).toMatchObject({ code: 'MAINTENANCE', maintenance: { message: 'Inwentaryzacja, wracamy o 14:00' } });
    }

    // The admin panel keeps working.
    await page.goto('/pl/dashboard/products');
    await expect(page.locator('nav, [role="navigation"], aside').first()).toBeVisible();

    await page.goto('/pl/dashboard/settings?tab=system');
    await section.getByRole('button', { name: 'Wyłącz przerwę w działaniu' }).click();
    await expect(section.getByTestId('maintenance-status')).toHaveText('Wyłączona: sklep działa.');
    await expect.poll(async () => (await request.get(`/pl/p/${productSlug}`)).status(), { timeout: 15000 }).toBe(200);

    const { data: audit } = await supabaseAdmin.from('audit_log').select('new_values')
      .eq('table_name', 'maintenance_mode').eq('performed_by', admin.userId).gte('performed_at', since).order('performed_at');
    expect(audit?.map(row => (row.new_values as { enabled: boolean }).enabled)).toEqual([true, false]);
  });

  test('a purchase paid before the break is completed by the Stripe webhook during it @J651', async ({ request }) => {
    test.skip(!process.env.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET is required');
    const email = `maintenance-buyer-${Date.now()}@example.com`;
    const event = await paidCheckoutEvent(productId, email);
    const session = event.data.object as Stripe.Checkout.Session;
    providerSessions.push(session.id);

    await setMaintenance(true);
    await expect.poll(async () => (await request.post('/api/create-payment-intent', { data: { productId } })).status(), { timeout: 15000 }).toBe(503);

    const delivered = await sendStripeEvent(request, event);
    expect(delivered.status()).toBe(200);
    const { data: order } = await supabaseAdmin.from('payment_transactions').select('status, customer_email').eq('session_id', session.id).single();
    expect(order).toEqual({ status: 'completed', customer_email: email });

    await setMaintenance(false);
  });

  test('no new free access during the break; a free-product request made before it still completes @J655', async ({ page, request }) => {
    const buyer = await createTestUser('maintenance-free-buyer');
    const createFree = async (name: string) => {
      const slug = `maintenance-free-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data, error } = await supabaseAdmin.from('products')
        .insert({ name, slug, price: 0, currency: 'USD', is_active: true, description: 'Maintenance free e2e' })
        .select('id').single();
      if (error) throw error;
      return { id: data.id as string, slug };
    };
    const fresh = await createFree('Maintenance New Claim');
    const earlier = await createFree('Maintenance Earlier Request');
    const access = async (productId: string) =>
      (await supabaseAdmin.from('user_product_access').select('id').eq('user_id', buyer.userId).eq('product_id', productId)).data ?? [];
    try {
      // Before the break the buyer asked for one free product (the request its email link carries).
      const { data: requestId, error: prepareError } = await supabaseAdmin.rpc('prepare_free_grant', { p_email: buyer.email, p_product_id: earlier.id, p_values: {} });
      if (prepareError) throw prepareError;

      await setMaintenance(true, 'Aktualizacja, wracamy za chwilę');
      await expect.poll(async () => (await request.get(`/pl/p/${fresh.slug}`)).status(), { timeout: 15000 }).toBe(503);
      await setAuthSession(page, buyer.email, buyer.password);

      // A new claim (the payment return page without a payment) grants nothing and says why.
      await page.goto(`/pl/p/${fresh.slug}/payment-status`);
      await expect(page.getByText('Sklep ma przerwę techniczną, więc teraz nie możemy dać darmowego dostępu.')).toBeVisible();
      await page.screenshot({ path: 'test-results/maintenance-free-refused.png', fullPage: true });
      expect(await access(fresh.id)).toEqual([]);
      // The magic-link callback without an earlier request shows the maintenance page.
      const callback = await page.goto(`/pl/auth/product-access?product=${fresh.slug}`);
      expect(callback?.status()).toBe(503);
      expect(await access(fresh.id)).toEqual([]);
      for (const path of ['/api/leads/submit', '/api/waitlist/signup', `/api/public/products/${fresh.slug}/grant-access`]) {
        expect((await request.post(path, { data: { productId: fresh.id, product: fresh.slug, email: buyer.email } })).status(), path).toBe(503);
      }

      // The link from the email of the earlier request completes it during the break.
      await page.goto(`/pl/auth/product-access?product=${earlier.slug}&free_grant=${requestId}`);
      await expect(page).toHaveURL(new RegExp(`/pl/p/${earlier.slug}/payment-status`));
      await expect(page.getByRole('heading', { name: 'Dostęp przyznany' })).toBeVisible();
      expect(await access(earlier.id)).toHaveLength(1);
    } finally {
      await setMaintenance(false);
      for (const product of [fresh, earlier]) {
        await supabaseAdmin.from('user_product_access').delete().eq('product_id', product.id);
        await supabaseAdmin.from('free_grant_contexts').delete().eq('product_id', product.id);
        await supabaseAdmin.from('products').delete().eq('id', product.id);
      }
      await buyer.cleanup();
    }
  });
});
