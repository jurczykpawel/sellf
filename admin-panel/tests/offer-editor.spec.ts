/** Offer editor and shared private preview acceptance on an explicitly owned stack. */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import type { Request } from '@playwright/test';
import { checkAccessibility } from './helpers/axe';

test('saves, previews, publishes and restores product offers in EN and PL', async ({ page, context, browser }) => {
  test.setTimeout(180000);
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const container = process.env.SUPABASE_DB_CONTAINER;
  if (!container || !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Owned stack required');
  expect(execFileSync('docker', ['port', container.replace('supabase_db_', 'supabase_kong_'), '8000/tcp'], { encoding: 'utf8' })).toContain(`:${url.port}`);
  const admin = await createTestAdmin('offer-editor');
  const { data: product, error } = await supabaseAdmin.from('products').insert({ name: 'Praktyczny warsztat automatyzacji', slug: `offer-editor-${Date.now()}`, price: 149, currency: 'PLN', vat_rate: 23, is_active: true, is_listed: true }).select('id,name,slug,price').single();
  if (error || !product) throw error ?? Error('Product required');
  try {
    await acceptAllCookies(page); await setAuthSession(page, admin.email, admin.password);
    await page.goto('/en/dashboard/templates?surface=offer');
    await page.getByRole('searchbox', { name: 'Choose a product · Search by name…' }).fill(product.name);
    await page.getByRole('button', { name: `Add ${product.name}`, exact: true }).click();
    const editor = page.locator('[data-offer-editor]');
    await expect(editor.getByRole('heading', { name: product.name })).toBeVisible();
    await editor.getByLabel('Enable offer page', { exact: true }).check();
    await editor.getByLabel('Hero · EN · Heading', { exact: true }).fill('Build your first useful automation');
    await editor.getByLabel('Hero · EN · Body', { exact: true }).fill('A practical workshop with time to build, test and improve your own workflow.');
    await editor.getByRole('button', { name: 'Add PL translation' }).click();
    await editor.getByLabel('Hero · PL · Heading', { exact: true }).fill('Zbuduj swoją pierwszą automatyzację');
    await editor.getByLabel('Hero · PL · Body', { exact: true }).fill('Praktyczny warsztat, na którym zbudujesz, przetestujesz i poprawisz swój własny proces.');
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(editor.getByRole('status')).toContainText('All changes saved');
    const saved = await supabaseAdmin.from('product_offer_config').select('revision,published').eq('product_id', product.id).single();
    expect(saved.data).toMatchObject({ revision: 1, published: null });
    // A second tab must retain local copy on conflict.
    const other = await context.newPage();
    await other.goto(`/en/dashboard/templates?product=${product.id}`);
    await expect(other.getByRole('heading', { name: product.name })).toBeVisible();
    await editor.getByLabel('Hero · PL · Heading', { exact: true }).fill('Zbuduj swoją pierwszą automatyzację — krok po kroku');
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(editor.getByRole('status')).toContainText('All changes saved');
    await other.getByLabel('Hero · EN · Heading', { exact: true }).fill('Second tab text');
    await other.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(other.locator('[data-offer-editor]').getByRole('alert')).toContainText('newer version');
    await expect(other.getByLabel('Hero · EN · Heading', { exact: true })).toHaveValue('Second tab text');
    await other.close();
    for (const locale of ['en', 'pl']) {
      await page.goto(`/${locale}/dashboard/templates?product=${product.id}`);
      await expect(editor.getByRole('heading', { name: product.name })).toBeVisible();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `/tmp/t210-editor-${locale}-${width}.png`, fullPage: true });
      }
      await editor.getByRole('button', { name: locale === 'pl' ? 'Pytania i odpowiedzi' : 'Questions & answers', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(editor.getByRole('heading', { name: locale === 'pl' ? 'Pytania i odpowiedzi' : 'Questions & answers', exact: true })).toBeVisible();
      await editor.getByRole('button', { name: locale === 'pl' ? 'Nagłówek' : 'Hero', exact: true }).click();
      await checkAccessibility(page);
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => { document.body.style.zoom = ''; document.documentElement.classList.add('dark'); });
      await page.emulateMedia({ colorScheme: 'dark' });
      await checkAccessibility(page);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: `/tmp/t210-editor-${locale}-dark-${width}.png`, fullPage: true });
      }
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(`/${locale}/admin/templates/history?product=${product.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(locale === 'pl' ? 'Historia oferty' : 'Offer history');
      await expect(page.getByRole('button', { name: locale === 'pl' ? 'Opublikuj tę wersję' : 'Publish this version', exact: true }).first()).toBeVisible();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `/tmp/t210-history-${locale}-${width}.png`, fullPage: true });
      }
      const preview = `/template-preview/2?locale=${locale}&fixture=published-products&productId=${product.id}`;
      const requests: string[] = [];
      const record = (request: Request) => requests.push(request.url());
      page.on('request', record);
      const response = await page.goto(preview);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toMatch(process.env.OFFER_TEST_RELEASE ? /no-store/ : /no-store|no-cache, must-revalidate/);
      expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
      expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
      expect(await page.evaluate(() => '__next_f' in window)).toBe(false);
      await expect(page.locator('[data-preview-inert]')).toHaveAttribute('inert', '');
      page.off('request', record);
      expect(requests.filter(url => /stripe|\/api\/|checkout|experiment|grant/i.test(url))).toEqual([]);
      await expect(page.locator('h1')).toHaveText(locale === 'pl' ? 'Zbuduj swoją pierwszą automatyzację — krok po kroku' : 'Build your first useful automation');
      await expect(page.locator(`a[href="/${locale}/checkout/${product.slug}"]`).first()).toBeAttached();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (locale === 'en' && width === 390) expect(await page.locator('[data-variant="simple"]').getByText('PLN 149.00', { exact: true }).evaluate(price => {
          const range = document.createRange(); range.selectNodeContents(price); return range.getClientRects().length;
        })).toBe(1);
        if (locale === 'pl' && width === 390) expect(await page.locator('h1').evaluate(heading => {
          const text = heading.firstChild!; const start = text.textContent!.indexOf('automatyzację');
          const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 'automatyzację'.length);
          return range.getClientRects().length;
        })).toBe(1);
        await page.screenshot({ path: `/tmp/t210-preview-${locale}-${width}.png`, fullPage: true });
      }
    }
    const anon = await browser.newContext();
    expect((await anon.request.get(`/template-preview/2?locale=en&fixture=published-products&productId=${product.id}&issuedAt=${Date.now()}`)).status()).toBe(404);
    await anon.close();
    for (const issuedAt of [Date.now() - 600001, Date.now() + 60000]) expect(await (await page.request.get(`/template-preview/2?locale=en&fixture=published-products&productId=${product.id}&issuedAt=${issuedAt}`)).text()).toContain('Preview unavailable');
    await page.goto(`/en/admin/templates/history?product=${product.id}`);
    await page.getByRole('button', { name: 'Publish this version', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText('Published as revision 3');
    expect((await supabaseAdmin.from('product_offer_config').select('published,draft').eq('product_id', product.id).single()).data).toMatchObject({ published: { enabled: true }, draft: null });
    // Baseline rollback turns the offer off without touching product commerce.
    await page.getByRole('button', { name: 'Restore this version', exact: true }).last().click();
    await expect(page.getByRole('status')).toContainText('Published as revision 4');
    expect((await supabaseAdmin.from('product_offer_config').select('published').eq('product_id', product.id).single()).data?.published).toBeNull();
    expect((await supabaseAdmin.from('products').select('price').eq('id', product.id).single()).data?.price).toBe(149);
    expect(await (await page.request.get(`/template-preview/2?locale=en&fixture=published-products&productId=${product.id}`)).text()).toContain('Preview unavailable');
  } finally {
    await supabaseAdmin.from('products').delete().eq('id', product.id);
    await admin.cleanup();
  }
});
