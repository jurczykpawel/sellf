/** Public offers and failed-invalidation acceptance on an explicitly owned stack. */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { checkAccessibility } from './helpers/axe';

test.skip(!process.env.SUPABASE_DB_CONTAINER || process.env.SUPABASE_DB_CONTAINER === 'supabase_db_sellf', 'Requires an explicitly owned isolated Supabase stack');

function ownedStack(): void {
  const container = process.env.SUPABASE_DB_CONTAINER;
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!container || container === 'supabase_db_sellf' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Owned isolated stack required');
  expect(execFileSync('docker', ['port', container.replace('supabase_db_', 'supabase_kong_'), '8000/tcp'], { encoding: 'utf8' })).toContain(`:${url.port}`);
}
const config = (heading: string) => ({ format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {
  'offer.hero': { sourceLocale: 'en', en: { kind: 'hero', eyebrow: 'Practical workshop', heading, body: 'Build, test and improve your first useful automation.', steps: ['Choose a useful workflow', 'Build and test your automation'] }, pl: { kind: 'hero', eyebrow: 'Praktyczny warsztat', heading: 'Zbuduj swoją pierwszą automatyzację', body: 'Zbuduj, przetestuj i popraw swój pierwszy użyteczny proces.', steps: ['Wybierz przydatny proces', 'Zbuduj i przetestuj automatyzację'] } },
  'offer.faq': { sourceLocale: 'en', en: { kind: 'faq', items: [{ id: 'access', question: 'How do I get access?', answer: 'Use the secure checkout to purchase access.' }] }, pl: { kind: 'faq', items: [{ id: 'access', question: 'Jak uzyskam dostęp?', answer: 'Kup dostęp przez bezpieczną stronę płatności.' }] } },
}, tokens: null });
async function fixture() {
  ownedStack();
  const { data, error } = await supabaseAdmin.from('products').insert({ name: 'Automation workshop', slug: `offer-public-${Date.now()}`, price: 149, currency: 'PLN', vat_rate: 23, is_active: true, is_listed: true, content_config: { private: 'PRIVATE_DELIVERY_SENTINEL' } }).select('id,slug').single();
  if (error || !data) throw error ?? Error('Product required');
  return data;
}
async function publish(id: string, published: unknown) {
  const { error } = await supabaseAdmin.from('product_offer_config').upsert({ product_id: id, published, draft: config('PRIVATE_DRAFT_SENTINEL') });
  if (error) throw error;
}

test('public opt-in, core routing, locale SEO, buyer isolation and responsive presentation @J77', async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  let product = await fixture();
  const buyer = await createTestUser('offer-buyer');
  try {
    // Unpublished/draft-only and explicit disabled states never create a route.
    await publish(product.id, null);
    expect((await page.request.get(`/offer/${product.slug}`)).status()).toBe(404);
    const disabled = await fixture();
    await publish(disabled.id, { ...config('Disabled'), enabled: false });
    expect((await page.request.get(`/offer/${disabled.slug}`)).status()).toBe(404);
    await supabaseAdmin.from('products').delete().eq('id', disabled.id);
    // New product avoids relying on invalidation from test-only direct database writes.
    await supabaseAdmin.from('products').delete().eq('id', product.id);
    product = await fixture();
    const slug = product.slug;
    await publish(product.id, config('Build your first useful automation'));
    await acceptAllCookies(page);
    for (const locale of ['en', 'pl']) {
      const path = `${locale === 'en' ? '' : '/pl'}/offer/${slug}`;
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('[data-template="offer-default"]')).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!).pathname).toBe(path);
      const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
      expect(new URL(ld.url).pathname).toBe(path); expect(ld.offers.price).toBe(149); expect(ld.offers.priceCurrency).toBe('PLN');
      expect(await response!.text()).not.toMatch(/PRIVATE_DRAFT_SENTINEL|PRIVATE_DELIVERY_SENTINEL/);
      await expect(page.locator(`a[href="/${locale}/checkout/${slug}"]`).first()).toBeVisible();
      await page.locator('summary').focus(); await page.keyboard.press('Enter'); await expect(page.locator('details')).toHaveAttribute('open', '');
      await page.locator('summary').evaluate(element => element.blur());
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `/tmp/t211-${locale}-${width}.png`, fullPage: true });
      }
      await checkAccessibility(page);
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await checkAccessibility(page);
      await page.screenshot({ path: `/tmp/t211-${locale}-dark-390.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: 'light' });
      // Search by product title (canonical product name), with fresh uncached catalogue input.
      await page.goto(`/${locale}/store?search=Automation%20workshop`);
      await expect(page.locator(`a[href="/${locale}/offer/${slug}"]`).first()).toBeVisible();
    }
    await supabaseAdmin.from('products').update({ is_active: false }).eq('id', product.id);
    expect((await page.request.get(`/offer/${slug}`)).status()).toBe(404);
    await supabaseAdmin.from('products').update({ is_active: true }).eq('id', product.id);
    await page.goto(`/p/${slug}`); await expect(page.locator('[data-template="offer-default"]')).toHaveCount(0);
    await expect(page.locator('h1')).toContainText('Automation workshop');
    await page.goto(`/p/${slug}?coupon=TEST&oto=offer`);
    await expect.poll(() => new URL(page.url()).pathname.endsWith(`/checkout/${slug}`)).toBe(true);
    expect(new URL(page.url()).searchParams.get('coupon')).toBe('TEST');
    expect(new URL(page.url()).searchParams.get('oto')).toBe('offer');
    const { error } = await supabaseAdmin.from('user_product_access').insert({ user_id: buyer.userId, product_id: product.id }); if (error) throw error;
    await setAuthSession(page, buyer.email, buyer.password); await page.goto(`/en/p/${slug}`);
    await expect(page.getByText('Access Granted', { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-template="offer-default"]')).toHaveCount(0);
    expect((await page.request.get(`/offer/${slug}`)).status()).toBe(200);
    const noScripts = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try { const p = await noScripts.newPage(); await p.goto(`/offer/${slug}`); await expect(p.locator('h1')).toHaveText('Build your first useful automation'); await expect(p.locator(`a[href="/en/checkout/${slug}"]`).first()).toBeVisible(); } finally { await noScripts.close(); }
  } finally { await buyer.cleanup(); await supabaseAdmin.from('products').delete().eq('id', product.id); }
});

test('two production replicas bound lost invalidation and scheduled availability/sale', async ({ request, baseURL }) => {
  test.setTimeout(200000);
  const second = process.env.OFFER_REPLICA_URL;
  test.skip(!second, 'Requires OFFER_REPLICA_URL pointing to a second production process');
  const product = await fixture();
  const origins = [baseURL!, second!];
  const read = async (origin: string) => { const response = await request.get(`${origin}/offer/${product.slug}`); return { status: response.status(), html: await response.text() }; };
  try {
    await publish(product.id, config('Original offer heading'));
    for (const origin of origins) expect((await read(origin)).html).toContain('Original offer heading');
    const warmedAt = Date.now();
    await expect.poll(() => Date.now() - warmedAt, { timeout: 3000, intervals: [250] }).toBeGreaterThanOrEqual(2000);
    const editedAt = Date.now(); await publish(product.id, config('Edited offer heading'));
    await expect.poll(async () => (await Promise.all(origins.map(read))).every(r => r.html.includes('Edited offer heading')), { timeout: 61000, intervals: [250] }).toBe(true);
    console.log(`Offer edit on both replicas: ${Date.now() - editedAt}ms`);
    // Sale and availability must be fresh at the first request after each boundary.
    const saleAt = Date.now() + 7000;
    await supabaseAdmin.from('products').update({ sale_price: 99, sale_price_until: new Date(saleAt).toISOString() }).eq('id', product.id);
    for (const origin of origins) expect((await read(origin)).html).toContain('99.00');
    await expect.poll(() => Date.now(), { timeout: 9000, intervals: [250] }).toBeGreaterThanOrEqual(saleAt);
    for (const origin of origins) { const result = await read(origin); expect(result.html).toContain('149.00'); expect(result.html).not.toContain('99.00'); }
    const unavailableAt = Date.now() + 7000;
    await supabaseAdmin.from('products').update({ available_until: new Date(unavailableAt).toISOString() }).eq('id', product.id);
    for (const origin of origins) expect((await read(origin)).html).toContain(`/en/checkout/${product.slug}`);
    await expect.poll(() => Date.now(), { timeout: 9000, intervals: [250] }).toBeGreaterThanOrEqual(unavailableAt);
    for (const origin of origins) expect((await read(origin)).html).not.toContain(`/en/checkout/${product.slug}`);
    // Warm publication again, then opt out without any app/tag/path invalidation.
    const disabledAt = Date.now(); await publish(product.id, null);
    await expect.poll(async () => (await Promise.all(origins.map(read))).every(r => r.status === 404), { timeout: 61000, intervals: [250] }).toBe(true);
    console.log(`Offer opt-out on both replicas: ${Date.now() - disabledAt}ms`);
  } finally { await supabaseAdmin.from('products').delete().eq('id', product.id); }
});
