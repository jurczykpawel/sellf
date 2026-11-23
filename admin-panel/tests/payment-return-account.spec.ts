import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
useSupabaseBuyerEmails();

test('a paid return offers account recovery without showing the other buyer @J732', async ({ page }) => {
  const a = await createTestUser('return-a'), b = await createTestUser('return-b');
  const id = randomUUID(), session = `cs_test_${randomUUID()}`;
  try {
    expect((await db.from('products').insert({ id, slug: id, name: 'Account receipt', price: 10, currency: 'PLN' })).error).toBeNull();
    expect((await db.from('payment_transactions').insert({ product_id: id, user_id: b.userId, customer_email: b.email, amount: 1000, currency: 'PLN', status: 'completed', session_id: session })).error).toBeNull();
    expect((await db.from('user_product_access').insert({ product_id: id, user_id: b.userId })).error).toBeNull();
    await setAuthSession(page, a.email, a.password);
    await page.goto(`/en/p/${id}/payment-status?session_id=${session}`);
    await expect(page.getByText('This purchase belongs to another account', { exact: true })).toBeVisible();
    await expect(page.getByText(b.email, { exact: false })).toHaveCount(0);
    const denied = await page.request.post('/api/verify-payment', { data: { session_id: session } });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).not.toHaveProperty('customer_email');
    await page.screenshot({ path: `${process.env.STRIPE_LIVE_ARTIFACTS || '/private/tmp/sellf-w315'}/account-mismatch.png` });
    await page.getByRole('button', { name: 'Sign out and continue' }).click();
    await expect(page.getByText('This purchase belongs to another account', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Payment Successful!', { exact: true })).toBeVisible();
    expect((await db.from('user_product_access').select('user_id').eq('product_id', id)).data).toEqual([{ user_id: b.userId }]);
  } finally {
    await db.from('user_product_access').delete().eq('product_id', id);
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
    await a.cleanup(); await b.cleanup();
  }
});

test('profile quantities are enforced by both checkout entry points @J733', async ({ request }) => {
  const id = randomUUID();
  try {
    expect((await db.from('products').insert({ id, slug: id, name: 'Minimum two', price: 100, currency: 'PLN', embed_enabled: true })).error).toBeNull();
    for (const mode of ['hidden', 'checkout', 'product_page']) {
      expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 2, max: 3, mode }] } }).eq('id', id)).error).toBeNull();
      const native = await request.post('/api/create-payment-intent', { data: { productId: id, quantity: 1 } });
      expect(native.status()).toBe(400);
      expect(await native.json()).toMatchObject({ error: 'Invalid order quantity' });
      const embed = await request.post('/api/embed/checkout-session', { headers: { Origin: 'https://merchant.example.com' }, data: { productSlug: id } });
      expect(embed.status()).toBe(422);
      expect(await embed.json()).toMatchObject({ code: 'STANDARD_CHECKOUT_REQUIRED' });
    }
    expect((await db.from('payment_transactions').select('id').eq('product_id', id)).data).toEqual([]);
  } finally { await db.from('products').delete().eq('id', id); }
});
