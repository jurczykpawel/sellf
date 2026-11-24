/** Live release acceptance using the real application, session and database. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin as db } from './admin/tests/helpers/admin-auth';
import { acceptAllCookies } from './admin/tests/helpers/consent';
import en from './admin/src/messages/en.json';
import pl from './admin/src/messages/pl.json';

for (const locale of ['en', 'pl'] as const) test(`${locale}: live marketing save, database reload and canonical parity`, async ({ page, browser }, info) => {
  const slug = `rcgate-marketing-${randomUUID()}`;
  const content = [{ id: 'release-copy', type: 'download_link', title: 'Retained lesson', config: { download_url: 'https://example.supabase.co/storage/v1/object/public/files/private-release.pdf', file_name: 'release.pdf' }, order: 0, is_active: true }];
  const created = await db.from('products').insert({ name: slug, slug, description: 'Release acceptance', price: 10, currency: 'PLN', vat_exempt: true, is_active: true, is_listed: true, content_delivery_type: 'content', content_config: { content_items: content }, marketing_fields: { format: null, sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } } }).select('id').single();
  expect(created.error).toBeNull(); const id = created.data!.id;
  const labels = (locale === 'en' ? en : pl).admin.products.form.marketing;
  const expected = { format: 'workshop', sourceLocale: 'en', en: { result: 'Build the release report', tools: ['Bun'], requirements: ['A local browser'] }, pl: { result: 'Zbuduj raport wydania', tools: ['Przeglądarka'], requirements: ['Lokalny komputer'] } };
  try {
    await acceptAllCookies(page);
    await setAuthSession(page, 'demo@sellf.app', 'demo123');
    await page.goto(`/${locale}/dashboard/products`);
    const row = page.locator('tr').filter({ hasText: slug });
    await expect(row).toBeVisible();
    await row.locator('button[title*="Edit"], button[title*="Edytuj"]').click();
    const modal = page.getByRole('dialog').filter({ has: page.locator('#wizard-form') });
    await modal.getByRole('button', { name: /^Offer$|^Oferta$/ }).click();
    const editor = modal.getByTestId('product-marketing');
    await expect(editor).toBeVisible();
    await editor.getByLabel(labels.format, { exact: true }).selectOption('workshop');
    await editor.getByLabel(labels.sourceLocale, { exact: true }).selectOption('en');
    for (const copyLocale of ['en', 'pl'] as const) {
      await editor.getByLabel(labels.locale, { exact: true }).selectOption(copyLocale);
      if (copyLocale === 'pl') await editor.getByRole('button', { name: labels.addTranslation, exact: true }).click();
      await editor.getByLabel(labels.result, { exact: true }).fill(expected[copyLocale].result);
      await editor.getByRole('button', { name: labels.addTools, exact: true }).click();
      await editor.getByLabel(`${labels.tools} 1`, { exact: true }).fill(expected[copyLocale].tools[0]);
      await editor.getByRole('button', { name: labels.addRequirements, exact: true }).click();
      await editor.getByLabel(`${labels.requirements} 1`, { exact: true }).fill(expected[copyLocale].requirements[0]);
    }
    await modal.getByRole('button', { name: /Update product|Aktualizuj produkt/i }).click();
    await expect(modal).toBeHidden();
    const saved = await db.from('products').select('marketing_fields,content_config').eq('id', id).single();
    expect(saved.error).toBeNull(); expect(saved.data!.marketing_fields).toEqual(expected); expect(saved.data!.content_config).toEqual({ content_items: content });
    await page.reload();
    await row.locator('button[title*="Edit"], button[title*="Edytuj"]').click();
    await modal.getByRole('button', { name: /^Offer$|^Oferta$/ }).click();
    for (const copyLocale of ['en', 'pl'] as const) {
      await editor.getByLabel(labels.locale, { exact: true }).selectOption(copyLocale);
      await expect(editor.getByLabel(labels.result, { exact: true })).toHaveValue(expected[copyLocale].result);
      await expect(editor.getByLabel(`${labels.tools} 1`, { exact: true })).toHaveValue(expected[copyLocale].tools[0]);
      await expect(editor.getByLabel(`${labels.requirements} 1`, { exact: true })).toHaveValue(expected[copyLocale].requirements[0]);
    }
    await expect(editor.getByLabel(labels.format, { exact: true })).toHaveValue('workshop');
    await page.screenshot({ path: info.outputPath(`marketing-${locale}.png`), fullPage: true });
    const guest = await browser.newContext({ javaScriptEnabled: false });
    try {
      const publicPage = await guest.newPage();
      for (const lang of ['en', 'pl'] as const) for (const route of ['', '/store', `/p/${slug}`]) {
        const prefix = lang === 'en' ? '' : '/pl';
        const path = `${prefix}${route}` || '/';
        const response = await publicPage.goto(path);
        expect(response?.status()).toBe(200);
        await expect(publicPage.locator('html')).toHaveAttribute('lang', lang);
        await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute('href', `http://localhost:3777${path === "/" ? "" : path}`);
        await expect(publicPage.locator('h1')).toHaveCount(1);
      }
    } finally { await guest.close(); }
  } finally {
    const removed = await page.request.delete(`/api/v1/products/${id}`, { headers: { Origin: 'http://localhost:3777' } }); expect(removed.status()).toBe(204);
  }
});

test('public catalogue retains price, duration and availability facts', async ({ request }) => {
  const suffix = randomUUID(); const name = `RC buyer facts ${suffix}`;
  const until = new Date(Date.now() + 86400000).toISOString();
  const created = await db.from('products').insert({ name, slug: `rc-facts-${suffix}`, description: 'A retained product description', price: 20, sale_price: 10, currency: 'USD', vat_exempt: true, is_active: true, is_listed: true, auto_grant_duration_days: 30, available_until: until }).select('id').single();
  expect(created.error).toBeNull();
  try {
    const input = { locale: 'en', search: name, categoryIds: [], priceKind: null, format: null, group: 'all', cursor: null, pageSize: 12 };
    const response = await request.get('/api/storefront/catalogue?input=' + encodeURIComponent(JSON.stringify(input)));
    expect(response.status()).toBe(200);
    const result = await response.json(); expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ description: 'A retained product description', accessDurationDays: 30, availableUntil: until, price: { display: '$10.00', originalDisplay: '$20.00', kind: 'one-time' }, availability: 'available' });
  } finally {
    const removed = await db.from('products').delete().eq('id', created.data!.id); expect(removed.error).toBeNull();
  }
});
