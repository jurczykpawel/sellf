/** Buyer recovery, receipts and purchased access on the local stack. */
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { test, expect } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';
import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
import { signTransferToken } from '@/lib/orders/transfer-token';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import lost from './fixtures/stripe/charge_dispute_closed_lost.json';
useSupabaseBuyerEmails();
const products: string[] = [];
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> { if (error) throw error; return data; }
async function product(extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  const p = (await checked(await db.from('products').insert({ name: `Buyer course ${id}`, slug: `buyer-${id}`, price: 20, currency: 'PLN', is_active: true, ...extra }).select('id,slug,name').single()))!;
  products.push(p.id); return p;
}
let tracking: { id: string; cookie_consent_enabled: boolean | null };
test.beforeAll(async () => {
  tracking = (await checked(await db.from('integrations_config').select('id,cookie_consent_enabled').single()))!;
  await checked(await db.from('integrations_config').update({ cookie_consent_enabled: true }).eq('id', tracking.id));
});
test.afterAll(async () => {
  const pending = products.length ? await checked(await db.from('payment_transactions').select('session_id')
    .in('product_id', products).in('status', ['pending', 'abandoned']).eq('payment_provider', 'stripe')) : [];
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  for (const order of pending ?? []) {
    if (!order.session_id?.startsWith('cs_test_')) continue;
    const session = await stripe.checkout.sessions.retrieve(order.session_id);
    if (session.status === 'open') expect((await stripe.checkout.sessions.expire(session.id)).status).toBe('expired');
  }
  await db.from('integrations_config').update({ cookie_consent_enabled: tracking.cookie_consent_enabled }).eq('id', tracking.id);
  await db.from('guest_purchases').delete().in('product_id', products);
  await db.from('payment_transactions').delete().in('product_id', products);
  await db.from('subscriptions').delete().in('product_id', products);
  await db.from('products').delete().in('id', products);
});

test('a fresh login link removes the old error and really signs in @J185', async ({ page }) => {
  const user = await createTestUser('link-recovery');
  try {
    await acceptAllCookies(page);
    await page.goto('/pl/login?error=magic_link_expired');
    await expect(page.getByText('Ten link został już użyty lub wygasł', { exact: false })).toBeVisible();
    await page.locator('#email').fill(user.email);
    await page.locator('label[for="terms-checkbox"] > div').click();
    await page.getByRole('button', { name: 'Wyślij link na maila', exact: true }).click();
    await expect(page.getByText('Sukces! Sprawdź swój email', { exact: false })).toBeVisible();
    await expect(page.getByText('Ten link został już użyty lub wygasł', { exact: false })).toHaveCount(0);
    const mail = await waitForEmail(user.email);
    await page.goto(extractMagicLink(mail.HTML || mail.Text || '')!);
    await expect(page).toHaveURL(/\/my-products/);
  } finally { await user.cleanup(); }
});

test('one refund keeps another paid purchase visible until the last refund @J34', async ({ page }) => {
  const user = await createTestUser('repeat-buyer'), p = await product({ allow_repeat_purchase: true });
  try {
    const orders = (await checked(await db.from('payment_transactions').insert([1, 2, 3].map(() => ({ product_id: p.id, user_id: user.userId, customer_email: user.email, amount: 2000, currency: 'PLN', status: 'completed', session_id: `cs_${randomUUID().replaceAll('-', '')}` }))).select('id,session_id')))!;
    await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: user.userId, product_id_param: p.id, transaction_id_param: orders[0].id }));
    await acceptAllCookies(page); await setAuthSession(page, user.email, user.password);
    await page.goto('/pl/my-products'); await expect(page.getByText(p.name, { exact: true })).toBeVisible();
    for (const [i, order] of orders.entries()) {
      await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 2000 }).eq('id', order.id));
      expect((await revokeTransactionAccess(db, { transactionId: order.id, userId: user.userId, productId: p.id, sessionId: order.session_id })).success).toBe(true);
      await page.reload();
      if (i < 2) await expect(page.getByText(p.name, { exact: true })).toBeVisible();
      else await expect(page.getByText(p.name, { exact: true })).toHaveCount(0);
    }
  } finally { await user.cleanup(); }
});

for (const source of ['timed', 'expired', 'disputed'] as const) {
  test(`refund recalculates the buyer's ${source} access @J34`, async ({ page }) => {
    const user = await createTestUser('period-buyer');
    const p = await product({ allow_repeat_purchase: true, auto_grant_duration_days: 30 });
    try {
      async function paid(age = 0) {
        return (await checked(await db.from('payment_transactions').insert({ product_id: p.id, user_id: user.userId, customer_email: user.email,
          amount: 2000, currency: 'PLN', status: 'completed', session_id: `cs_${randomUUID().replaceAll('-', '')}`,
          created_at: new Date(Date.now() - age * 86400000).toISOString() }).select('id,session_id').single()))!;
      }
      async function grant(id: string) {
        expect((await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: user.userId, product_id_param: p.id, transaction_id_param: id }))).success).toBe(true);
      }
      const a = await paid(source === 'expired' ? 40 : 0);
      if (source === 'expired') {
        await checked(await db.from('user_product_access').insert({ user_id: user.userId, product_id: p.id,
          access_granted_at: new Date(Date.now() - 40 * 86400000).toISOString(), access_expires_at: new Date(Date.now() - 10 * 86400000).toISOString(), access_duration_days: 30 }));
      } else await grant(a.id);
      const first = (await checked(await db.from('user_product_access').select('id,access_expires_at').eq('user_id', user.userId).eq('product_id', p.id).single()))!;
      if (source === 'disputed') {
        const d = lost.data.object;
        await checked(await db.rpc('apply_payment_dispute', { p_transaction_id: a.id, p_dispute_id: `dp_${randomUUID()}`, p_status: d.status,
          p_closed: true, p_reason: d.reason, p_amount: d.amount, p_currency: d.currency, p_created: new Date(d.created * 1000).toISOString() }));
      }
      const b = await paid(); await grant(b.id);
      await acceptAllCookies(page); await setAuthSession(page, user.email, user.password);
      await page.goto('/pl/my-products'); await expect(page.getByText(p.name, { exact: true })).toBeVisible();
      await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 2000 }).eq('id', b.id));
      expect((await revokeTransactionAccess(db, { transactionId: b.id, userId: user.userId, productId: p.id, sessionId: b.session_id })).success).toBe(true);
      await page.reload();
      if (source === 'timed') {
        await expect(page.getByText(p.name, { exact: true })).toBeVisible();
        expect(await checked(await db.from('user_product_access').select('id,access_expires_at').eq('user_id', user.userId).eq('product_id', p.id))).toEqual([first]);
      } else await expect(page.getByText(p.name, { exact: true })).toHaveCount(0);
    } finally { await user.cleanup(); }
  });
}

for (const mode of ['inactive', 'archived'] as const) {
  test(`paid guest receipt, first mail and claim survive ${mode} offer @J185`, async ({ page }) => {
    const p = await product(), email = `paid-guest-${randomUUID()}@example.com`, session = `cs_${randomUUID().replaceAll('-', '')}`;
    let userId: string | undefined;
    try {
      await checked(await db.from('payment_transactions').insert({ product_id: p.id, customer_email: email, amount: 2000, currency: 'PLN', status: 'pending', session_id: session }));
      await checked(await db.from('products').update({ is_active: false, ...(mode === 'archived' ? { archived_at: new Date().toISOString() } : {}) }).eq('id', p.id));
      const paid = await checked(await db.rpc('process_stripe_payment_completion_with_bump', { session_id_param: session, product_id_param: p.id, customer_email_param: email, amount_total: 2000, currency_param: 'PLN', allow_inactive_product_param: true })); expect(paid.success).toBe(true);
      await checked(await db.from('payment_transactions').update({ fulfillment_pending: false }).eq('session_id', session));
      await acceptAllCookies(page);
      await page.goto(`/pl/p/${p.slug}/payment-status?session_id=${session}`);
      await expect(page).toHaveURL(/payment-status/);
      const mail = await waitForEmail(email, { timeout: 30000 });
      expect(mail.HTML).toContain(p.name);
      expect(mail.To.map(to => to.Address.toLowerCase())).toContain(email);
      await page.goto(extractMagicLink(mail.HTML || mail.Text || '')!);
      await expect.poll(async () => {
        const guests = await checked(await db.from('guest_purchases').select('claimed_by_user_id').eq('session_id', session));
        userId = guests?.[0]?.claimed_by_user_id ?? undefined; return userId;
      }).toBeTruthy();
      expect(await checked(await db.from('user_product_access').select('product_id').eq('user_id', userId!))).toEqual([{ product_id: p.id }]);
      await page.goto('/pl/my-products'); await expect(page.getByText(p.name, { exact: true })).toBeVisible();
      if (mode === 'inactive') {
        await expect(page.getByText('Sprzedawca wstrzymał dostęp do tego produktu. Twój zakup pozostaje zapisany.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Otwórz produkt', exact: true })).toHaveCount(0);
      }
    } finally { if (userId) await db.auth.admin.deleteUser(userId); }
  });
}

test('open transfer expires without reload, and A4 print has one page @J182', async ({ page }, info) => {
  test.setTimeout(90000);
  const p = await product(), id = randomUUID();
  await checked(await db.from('payment_transactions').insert({ id, product_id: p.id, customer_email: `receipt-${id}@example.com`, amount: 2000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, transfer_details: { account: 'PL61109010140000071219812874', title: 'Order', holder: 'Seller' } }));
  await acceptAllCookies(page);
  await page.goto(`/pl/order/${id}/transfer?token=${signTransferToken(id)}`);
  await expect(page.getByRole('region', { name: 'Dane do przelewu' })).toBeVisible();
  await checked(await db.from('payment_transactions').update({ release_at: new Date(Date.now() + 15000).toISOString() }).eq('id', id));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Dane do przelewu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preferencje ciasteczek', exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Preferencje ciasteczek', exact: true })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4', path: info.outputPath('receipt.pdf') });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  await page.emulateMedia({ media: 'screen' });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Termin płatności minął', { timeout: 45000 });
  await expect(page.getByRole('region', { name: 'Dane do przelewu' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Zapłać online/ })).toHaveCount(0);
});

test('open transfer follows a cancellation by the seller @J182', async ({ page }) => {
  const p = await product(), id = randomUUID();
  await checked(await db.from('payment_transactions').insert({ id, product_id: p.id, customer_email: `cancel-${id}@example.com`, amount: 2000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, transfer_details: { account: 'PL61109010140000071219812874' } }));
  await page.goto(`/pl/order/${id}/transfer?token=${signTransferToken(id)}`);
  await expect(page.getByText('Oczekuje na przelew', { exact: true })).toBeVisible();
  await checked(await db.from('payment_transactions').update({ status: 'cancelled' }).eq('id', id));
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Tego zamówienia nie można już opłacić', { timeout: 25000 });
});

test('buyer history retains cancelled status and purchased subscription summary @J37', async ({ page }) => {
  const user = await createTestUser('buyer-history');
  const p = await product({ name: 'Purchased subscription', product_type: 'subscription', price: 0, recurring_price: 49, billing_interval: 'month', billing_interval_count: 1 });
  const cancelled = await product({ name: 'Cancelled transfer' });
  try {
    await checked(await db.from('subscriptions').insert({ user_id: user.userId, product_id: p.id, status: 'active', stripe_subscription_id: `sub_${randomUUID()}`, stripe_customer_id: `cus_${randomUUID()}` }));
    await checked(await db.from('products').update({ is_active: false, archived_at: new Date().toISOString(), name: 'Changed offer', recurring_price: 99 }).eq('id', p.id));
    await checked(await db.from('payment_transactions').insert({ product_id: cancelled.id, user_id: user.userId, customer_email: user.email, amount: 2000, currency: 'PLN', status: 'cancelled', payment_provider: 'bank_transfer', pricing_snapshot_version: 1 }));
    await acceptAllCookies(page); await setAuthSession(page, user.email, user.password);
    await page.goto('/pl/my-purchases');
    await expect(page.getByText('Anulowane — nie opłacaj tego zamówienia', { exact: true })).toBeVisible();
    await expect(page.getByText('Purchased subscription', { exact: true })).toBeVisible();
    await expect(page.getByText(/49,00/)).toBeVisible();
    await expect(page.getByText('Changed offer', { exact: true })).toHaveCount(0);
  } finally {
    await db.from('subscriptions').delete().eq('user_id', user.userId); await user.cleanup();
  }
});

test('Polish video shows Polish loading and provider failure @J185', async ({ page }) => {
  const p = await product({ preview_video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  let abortScript: (() => Promise<void>) | undefined;
  await page.route('**/playerstack.min.js', async route => { await new Promise<void>(resolve => { abortScript = async () => { await route.abort(); resolve(); }; }); });
  const checkoutReady = page.waitForResponse(response => response.url().endsWith('/api/create-payment-intent') && response.request().method() === 'POST');
  await page.goto(`/pl/p/${p.slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Ładowanie filmu…', { exact: true })).toBeVisible();
  await expect.poll(() => Boolean(abortScript)).toBe(true); await abortScript!();
  await expect(page.getByText('Film jest niedostępny', { exact: true })).toBeVisible();
  expect((await checkoutReady).status()).toBe(200);
});

for (const source of ['bundle', 'manual'] as const) {
  test(`buyer retains the independent ${source} deadline after refunds @J34`, async ({ page }) => {
    const user = await createTestUser(`buyer-refund-${source}`);
    const p = await product({ auto_grant_duration_days: 30, allow_repeat_purchase: true });
    const pack = source === 'bundle' ? await product({ is_bundle: true }) : null;
    try {
      if (pack) await checked(await db.from('bundle_items').insert({ bundle_product_id: pack.id, component_product_id: p.id }));
      async function buy(productId: string) {
        const t = (await checked(await db.from('payment_transactions').insert({ product_id: productId, user_id: user.userId, customer_email: user.email,
          amount: 2000, currency: 'PLN', status: 'completed', session_id: `cs_${randomUUID().replaceAll('-', '')}` }).select('id,session_id').single()))!;
        expect((await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: user.userId, product_id_param: productId, transaction_id_param: t.id }))).success).toBe(true);
        return t;
      }
      const first = await buy(p.id);
      const original = (await checked(await db.from('user_product_access').select('id,access_expires_at').eq('user_id', user.userId).eq('product_id', p.id).single()))!;
      const other = await buy(pack?.id ?? p.id);
      if (source === 'manual') await checked(await db.rpc('mutate_access', { p_action: 'update', p_user_id: user.userId, p_access_id: original.id,
        p_values: { access_expires_at: null }, p_actor: { type: 'api_key', id: randomUUID() } }));
      await acceptAllCookies(page); await setAuthSession(page,user.email,user.password);
      await page.goto('/pl/my-products'); await expect(page.getByText(p.name,{ exact: true })).toBeVisible();
      await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 2000 }).eq('id',other.id));
      const target = { transactionId: other.id, userId: user.userId, productId: pack?.id ?? p.id, sessionId: other.session_id };
      expect((await revokeTransactionAccess(db,target)).success).toBe(true);
      expect((await revokeTransactionAccess(db,target)).success).toBe(true);
      const retained = await checked(await db.from('user_product_access').select('id,access_expires_at').eq('id',original.id).single());
      expect(retained).toEqual({ id: original.id, access_expires_at: source === 'manual' ? null : original.access_expires_at });
      await page.reload(); await expect(page.getByText(p.name,{ exact: true })).toBeVisible();
      if (source === 'manual') {
        await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 2000 }).eq('id',first.id));
        expect((await revokeTransactionAccess(db,{ transactionId: first.id, userId: user.userId, productId: p.id, sessionId: first.session_id })).success).toBe(true);
        await page.reload(); await expect(page.getByText(p.name,{ exact: true })).toBeVisible();
      }
    } finally {
      if (pack) await db.from('bundle_items').delete().eq('bundle_product_id',pack.id);
      await user.cleanup();
    }
  });
}
