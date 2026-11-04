/**
 * W146 B2: "Send magic link" with an empty email on a free product shows the error next to the
 * field and the button comes back ready (it used to stay on "Verifying…" for good). PL and EN, 390 px.
 * @see src/components/captcha/AltchaWidget.tsx
 */
import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

const slug = `w151-free-${Date.now()}`;
let productId = '';

test.beforeAll(async () => {
  const { data, error } = await supabaseAdmin.from('products').insert({ name: 'W151 free guide', slug, description: 'Free guide', price: 0, currency: 'PLN', is_active: true }).select('id').single();
  if (error) throw error;
  productId = data.id;
});
test.afterAll(async () => { if (productId) await supabaseAdmin.from('products').delete().eq('id', productId); });

for (const [locale, button, error, verifying] of [
  ['pl', 'Wyślij magiczny link', 'Podaj swój adres e-mail', 'Weryfikacja...'],
  ['en', 'Send Magic Link', 'Please enter your email address', 'Verifying...'],
] as const) {
  test(`empty email shows a field error and keeps the form usable (${locale}, 390 px) @J01`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await acceptAllCookies(page);
    await page.goto(`/${locale}/checkout/${slug}`);
    const submit = page.getByRole('button', { name: button });
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();
    await expect(page.locator('#email-error')).toHaveText(error);
    await expect(page.getByText(verifying)).toHaveCount(0, { timeout: 15_000 });
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    await page.locator('#email').fill('buyer@example.com');
    await expect(page.locator('#email-error')).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });
}
