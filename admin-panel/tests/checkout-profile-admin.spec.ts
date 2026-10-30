import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

test('checkout profile settings persist after reopening the product wizard @J97', async ({ page }) => {
  test.setTimeout(90_000);
  const admin = await createTestAdmin('checkout-profile');
  const name = `Profile ${randomUUID()}`;
  const { data: product, error } = await supabaseAdmin.from('products').insert({ name, description: '', slug: name.toLowerCase().replaceAll(' ', '-'), price: 50, currency: 'PLN', vat_rate: 23 }).select('id').single();
  if (error || !product) throw error ?? new Error('Product missing');
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/products');
    const row = page.locator('tr, [data-product-id]').filter({ hasText: name });
    await row.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Sprzedaż i ustawienia/i }).click();
    await page.locator('[data-step3-group="B"]').getByRole('button').first().click();
    await page.getByLabel('Własny koszyk dla tego produktu').check();
    await page.getByLabel('Telefon', { exact: true }).check();
    await page.getByLabel('Telefon: wymagane').check();
    await page.screenshot({ path: test.info().outputPath('profile-editor.png') });
    const saved = page.waitForResponse(r => r.url().includes(`/api/v1/products/${product.id}`) && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: /Aktualizuj produkt/i }).click();
    const response = await saved;
    expect(response.status(), await response.text()).toBe(200);
    await expect(dialog).not.toBeVisible();
    await row.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();
    await page.getByRole('dialog').getByRole('button', { name: /Sprzedaż i ustawienia/i }).click();
    await page.locator('[data-step3-group="B"]').getByRole('button').first().click();
    await expect(page.getByLabel('Własny koszyk dla tego produktu')).toBeChecked();
    await expect(page.getByLabel('Telefon: wymagane')).toBeChecked();
    const { data } = await supabaseAdmin.from('products').select('checkout_profile').eq('id', product.id).single();
    expect(data?.checkout_profile).toMatchObject({ v: 1, modules: expect.arrayContaining([{ id: 'phone', required: true }]) });
  } finally {
    await supabaseAdmin.from('products').delete().eq('id', product.id);
    await admin.cleanup();
  }
});
