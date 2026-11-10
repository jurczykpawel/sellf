import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { DEFAULT_OFFER } from '../src/lib/storefront-templates/offer';

test('opens the current offer draft from editor and history buttons @J78', async ({ page, context }) => {
  expect(process.env.SLOT_TICKET).toBeTruthy();
  const admin = await createTestAdmin('preview-buttons');
  const { data: product, error } = await db.from('products').insert({ name: 'Preview buttons', slug: `preview-buttons-${Date.now()}`, price: 10, currency: 'PLN' }).select('id').single();
  if (error || !product) throw error ?? Error('Product required');
  const config = { ...structuredClone(DEFAULT_OFFER), enabled: true };
  const saved = await db.from('product_offer_config').insert({ product_id: product.id, revision: 1, draft: config });
  if (saved.error) throw saved.error;
  try {
    await setAuthSession(page, admin.email, admin.password);
    for (const path of [`/en/dashboard/templates?product=${product.id}`, `/en/admin/templates/history?product=${product.id}`]) {
      await page.goto(path);
      const button = page.getByRole('link', { name: /preview/i }).last();
      const popupPromise = context.waitForEvent('page');
      await button.click();
      const preview = await popupPromise;
      await expect(preview.locator('[data-preview-inert]')).toBeAttached();
      await expect(preview.getByText('Preview unavailable', { exact: true })).toHaveCount(0);
      await preview.close();
    }
  } finally { await db.from('products').delete().eq('id', product.id); await admin.cleanup(); }
});

test('opens the current storefront draft from both real preview buttons @J79', async ({ page, context }) => {
  expect(process.env.SLOT_TICKET).toBeTruthy();
  const { D_LOCALIZED_CONFIG } = await import('../src/lib/storefront-templates/fixtures');
  const admin = await createTestAdmin('storefront-preview-buttons');
  const original = await db.from('storefront_config').select('*').single();
  if (original.error) throw original.error;
  try {
    await setAuthSession(page, admin.email, admin.password);
    for (const templateId of ['d', 'storefront-a'] as const) {
      const draft = { ...structuredClone(D_LOCALIZED_CONFIG), templateId, settingsByTemplate: { ...D_LOCALIZED_CONFIG.settingsByTemplate, 'storefront-a': { heroProduct: 'af000000-0000-4000-a000-000000000002' } } };
      const saved = await db.from('storefront_config').update({ revision: 59, draft }).eq('id', true);
      if (saved.error) throw saved.error;
      for (const path of ['/pl/dashboard/templates', '/pl/admin/templates/history']) {
        await page.goto(path);
        const previewPromise = context.waitForEvent('page');
        await page.locator('a[href^="/template-preview/"]').first().click();
        const preview = await previewPromise;
        await expect(preview.locator('[data-preview-inert]')).toBeAttached();
        expect(new URL(preview.url()).pathname).toBe('/template-preview/59');
        expect(new URL(preview.url()).searchParams.get('issuedAt')).toMatch(/^\d+$/);
        await preview.close();
      }
    }
  } finally {
    await db.from('storefront_config').update(original.data).eq('id', true);
    await admin.cleanup();
  }
});
