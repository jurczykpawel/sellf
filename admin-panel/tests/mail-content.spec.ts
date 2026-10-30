/** Delivered auth link reuse and payment-status resend. */
import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';
import { acceptAllCookies } from './helpers/consent';

for (const locale of ['pl', 'en']) {
  test(`used email link offers a new link in ${locale} @J88`, async ({ page, baseURL }) => {
    const email = `used-mail-${crypto.randomUUID()}@example.com`;
    const redirectTo = `${baseURL}/auth/callback?flow=login`;
    try {
      expect((await supabaseAdmin.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, data: { locale } } })).error).toBeNull();
      const mail = await waitForEmail(email);
      const link = extractMagicLink(mail.HTML!)!;
      expect(link).toBeTruthy();
      await acceptAllCookies(page);
      await page.goto(`/${locale}/login`);
      await page.goto(link);
      await expect(page).toHaveURL(/my-products|dashboard/);
      await page.context().clearCookies();
      await page.goto(`/${locale}/login`);
      await page.goto(link);
      await expect(page).toHaveURL(/error=magic_link_expired/);
      await expect(page.getByText(locale === 'pl' ? /Ten link został już użyty lub wygasł/ : /This link has already been used or has expired/)).toBeVisible();
      await expect(page.getByText(/Browser session interrupted|Sesja przeglądarki przerwana/)).toHaveCount(0);
    } finally {
      const user = (await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
      if (user) await supabaseAdmin.auth.admin.deleteUser(user.id);
    }
  });
}

test('payment status offers an explicit resend after the cooldown', async ({ page }) => {
  test.setTimeout(120000);
  const email = `resend-mail-${crypto.randomUUID()}@example.com`;
  const slug = `mail-${crypto.randomUUID()}`;
  const sessionId = `cs_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const { data: product, error } = await supabaseAdmin.from('products').insert({ name: 'Mail workshop', slug, price: 67, currency: 'PLN', is_active: true }).select('id').single();
  expect(error).toBeNull();
  const id = product!.id;
  let sends = 0;
  try {
    expect((await supabaseAdmin.from('payment_transactions').insert({ session_id: sessionId, product_id: id, customer_email: email, amount: 6700, currency: 'PLN', status: 'completed' })).error).toBeNull();
    // Keep this assertion on the page's resend controls; delivery is covered by Mailpit tests.
    await page.route('**/api/auth/magic-link', async route => { sends++; await route.fulfill({ json: { ok: true } }); });
    await acceptAllCookies(page);
    await page.goto(`/en/p/${slug}/payment-status?session_id=${sessionId}`);
    await expect(page.getByRole('heading', { name: 'Magic Link Sent!' })).toBeVisible({ timeout: 30000 });
    const button = page.getByRole('button', { name: /Resend in \d+s/ });
    await expect(button).toBeDisabled();
    await expect.poll(() => sends).toBe(1);
    await expect(page.getByRole('button', { name: 'Resend login link' })).toBeEnabled({ timeout: 70000 });
    expect(sends).toBe(1);
    await page.getByRole('button', { name: 'Resend login link' }).click();
    await expect.poll(() => sends).toBe(2);
    await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
  } finally {
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', id);
    await supabaseAdmin.from('products').delete().eq('id', id);
  }
});
