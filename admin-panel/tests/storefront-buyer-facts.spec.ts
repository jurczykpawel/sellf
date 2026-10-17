/** Buyer facts survive catalogue and compact presentation. @see lib/storefront-templates/catalogue.ts */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { D_LOCALIZED_CONFIG } from '@/lib/storefront-templates/fixtures';
import { getTestDatabaseContainer } from './helpers/database-container';
import { setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';

const prefix = `Buyer facts ${randomUUID()}`;
const paidName = `${prefix} paid`, freeName = `${prefix} free`;
const futureName = `${prefix} future`, expiredName = `${prefix} expired`;
const description = 'The original seller description remains visible.';
let ids: string[] = [], original: string, container: string, revision: number, until: string;
let shop: { id: string; omnibus_enabled: boolean };
function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
}
function literal(value: string): string { return "'" + value.replaceAll("'", "''") + "'::jsonb"; }

test.beforeAll(async () => {
  container = getTestDatabaseContainer(); expect(container).not.toBe('supabase_db_sellf');
  original = sql('SELECT to_jsonb(c) FROM public.storefront_config c');
  const config = await db.from('shop_config').select('id,omnibus_enabled').single();
  expect(config.error).toBeNull(); shop = config.data!;
  expect((await db.from('shop_config').update({ omnibus_enabled: true }).eq('id', shop.id)).error).toBeNull();
  until = new Date(Date.now() + 86400000).toISOString();
  const rows = await db.from('products').insert([
    { name: paidName, slug: `facts-paid-${randomUUID()}`, description, price: 20, sale_price: 10, currency: 'USD', vat_exempt: true, is_active: true, is_listed: true, auto_grant_duration_days: 30, available_until: until },
    { name: freeName, slug: `facts-free-${randomUUID()}`, price: 0, currency: 'USD', is_active: true, is_listed: true, auto_grant_duration_days: 7 },
    { name: futureName, slug: `facts-future-${randomUUID()}`, price: 10, currency: 'USD', is_active: true, is_listed: true, available_from: until },
    { name: expiredName, slug: `facts-expired-${randomUUID()}`, price: 10, currency: 'USD', is_active: true, is_listed: true, available_until: new Date(Date.now() - 86400000).toISOString() },
  ].map(value => ({ description: '', sale_price: null, vat_exempt: false, auto_grant_duration_days: null, available_from: null, available_until: null, ...value }))).select('id,name');
  expect(rows.error).toBeNull(); ids = rows.data!.map(row => row.id);
  const paid = rows.data!.find(row => row.name === paidName)!.id;
  const free = rows.data!.find(row => row.name === freeName)!.id;
  const future = rows.data!.find(row => row.name === futureName)!.id;
  expect((await db.from('product_price_history').delete().eq('product_id', paid)).error).toBeNull();
  const history = await db.from('product_price_history').insert([
    { product_id: paid, price: 18, sale_price: null, currency: 'USD', effective_from: new Date(Date.now() - 86400000).toISOString() },
    { product_id: paid, price: 20, sale_price: 10, currency: 'USD', effective_from: new Date(Date.now() - 1000).toISOString() },
  ]);
  expect(history.error).toBeNull();
  const draft: StorefrontConfig = structuredClone(D_LOCALIZED_CONFIG);
  draft.settingsByTemplate.d = { heroProduct: paid, closingProduct: paid, starterProducts: [paid, free, future], taskCategories: [] };
  draft.overridesByTemplate.d = { sections: { start: { variant: 'compact' } } };
  const saved = await db.rpc('mutate_storefront_config', { expected_revision: JSON.parse(original).revision, operation: 'draft', validated_config: draft, actor_user_id: 'dddddddd-0000-4000-a000-000000000000', actor_method: 'session' });
  expect(saved.error).toBeNull(); expect(saved.data).toMatchObject({ success: true });
  revision = (saved.data as { revision: number }).revision;
});

test.afterAll(async () => {
  if (original) {
    const before = JSON.parse(original).revision;
    sql(`BEGIN; UPDATE public.storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by FROM jsonb_populate_record(NULL::public.storefront_config,${literal(original)}) b WHERE c.id=true; DELETE FROM public.storefront_config_history WHERE revision>${before}; DELETE FROM public.audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${before}; COMMIT;`);
    expect(sql('SELECT to_jsonb(c) FROM public.storefront_config c')).toBe(original);
  }
  if (ids.length) expect((await db.from('products').delete().in('id', ids)).error).toBeNull();
  if (shop) expect((await db.from('shop_config').update({ omnibus_enabled: shop.omnibus_enabled }).eq('id', shop.id)).error).toBeNull();
});

for (const locale of ['en', 'pl'] as const) for (const surface of ['default', 'compact'] as const) {
  test(`${locale} ${surface}: price, sale, omnibus, free, access and availability`, async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    try {
      await acceptAllCookies(page);
      if (surface === 'compact') await setAuthSession(page, 'demo@sellf.app', 'demo123');
      const response = await page.goto(surface === 'default'
        ? `/${locale}/store?search=${encodeURIComponent(prefix)}`
        : `/template-preview/${revision}?locale=${locale}&fixture=published-products`);
      expect(response?.status()).toBe(200);
      const selector = surface === 'default' ? '#catalogue' : '[data-section="product-list/1"][data-variant="compact"]';
      const scope = page.locator(selector);
      const paid = scope.locator('article').filter({ has: page.getByRole('heading', { name: paidName, exact: true }) });
      const free = scope.locator('article').filter({ has: page.getByRole('heading', { name: freeName, exact: true }) });
      await expect(paid).toHaveCount(1); await expect(free).toHaveCount(1);
      await expect(paid.getByText(description, { exact: true })).toBeVisible();
      await expect(paid.locator('del')).toBeVisible();
      await expect(paid.locator('del')).toContainText(locale === 'en' ? '$20.00' : '20,00 USD');
      await expect(paid.getByText(locale === 'en' ? '$10.00' : '10,00 USD', { exact: true })).toBeVisible();
      await expect(paid.getByText(locale === 'en' ? /\$18\.00/ : /18,00\u00a0USD/)).toBeVisible();
      await expect(paid.getByText(locale === 'en' ? '30d access' : '30d dostęp', { exact: true })).toBeVisible();
      await expect(paid.locator('time')).toBeVisible(); await expect(paid.locator('time')).toHaveAttribute('datetime', until);
      await expect(free.getByText(locale === 'en' ? 'Free' : 'Za darmo', { exact: true })).toBeVisible();
      await expect(free.getByText(locale === 'en' ? '7d access' : '7d dostęp', { exact: true })).toBeVisible();
      await expect(free.locator('del')).toHaveCount(0);
      await expect(scope.getByRole('heading', { name: futureName, exact: true })).toHaveCount(0);
      await expect(scope.getByRole('heading', { name: expiredName, exact: true })).toHaveCount(0);
      expect((await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width !== 320) await page.screenshot({ path: info.outputPath(`buyer-facts-${width}.png`), fullPage: true });
      }
    } finally { await context.close(); }
  });
}
