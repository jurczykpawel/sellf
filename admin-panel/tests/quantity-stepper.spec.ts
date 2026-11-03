/** Quantity control: visible before the coupon, large enough to tap, and the summary follows it. */
import { test, expect } from '@playwright/test';
import { supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

let productId: string, slug: string;
test.beforeAll(async () => {
  slug = `qty-stepper-${crypto.randomUUID()}`;
  const { data, error } = await db.from('products').insert({ name: 'Zestaw szkoleniowy', slug, price: 50, currency: 'PLN', is_active: true,
    checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 3, mode: 'checkout' }] } }).select('id').single();
  expect(error).toBeNull(); productId = data!.id;
});
test.afterAll(async () => { await db.from('products').delete().eq('id', productId); });

for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['390 px phone', { width: 390, height: 844 }]] as const) {
  test(`${name}: stepper is visible above the coupon, tappable and drives the summary @J198`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${slug}`);
    const input = page.getByLabel('Ilość', { exact: true });
    const plus = page.getByRole('button', { name: 'Zwiększ ilość' });
    const minus = page.getByRole('button', { name: 'Zmniejsz ilość' });
    await expect(input).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Od 1 do 3')).toBeVisible();
    for (const control of [plus, minus, input]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await expect(minus).toBeDisabled();
    await plus.click();
    await expect(input).toHaveValue('2');
    await expect(page.getByText(/100,00\s?zł/).first()).toBeVisible();
    await plus.click();
    await expect(plus).toBeDisabled();
    await input.fill('9');
    await expect(page.locator('#checkoutQuantity-error')).toBeVisible();
    await plus.click();
    await expect(input).toHaveValue('1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const quantityTop = (await input.boundingBox())!.y;
    const coupon = page.getByText(/kod rabatowy/i).first();
    if (await coupon.count()) expect((await coupon.boundingBox())!.y).toBeGreaterThan(quantityTop);
    await page.screenshot({ path: test.info().outputPath(`quantity-${viewport.width}.png`), fullPage: true });
  });
}
