import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

const slug = `public-hydration-${Date.now()}`;
const email = 'contact@example.com';
const couponCode = `HYDRATE${randomUUID().slice(0, 8).toUpperCase()}`;
let productId: string;
let couponId: string;
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test.beforeAll(async () => {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.SUPABASE_URL!).hostname);
  const { data, error } = await admin.from('products').insert({
    slug, name: `Course ${email}`, description: 'Hydration fixture',
    price: 49, currency: 'PLN', is_active: true, is_listed: true,
    sale_price: 25, sale_price_until: '2099-10-17T12:30:00Z',
  }).select('id').single();
  expect(error).toBeNull(); productId = data!.id;
  const coupon = await admin.from('coupons').insert({ code: couponCode, discount_type: 'percentage', discount_value: 10, is_active: true, allowed_product_ids: [productId] }).select('id').single();
  expect(coupon.error).toBeNull(); couponId = coupon.data!.id;
});
test.afterAll(async () => {
  if (couponId) {
    await admin.from('coupon_reservations').delete().eq('coupon_id', couponId);
    await admin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
    await admin.from('coupons').delete().eq('id', couponId);
  }
  if (productId) await admin.from('payment_transactions').delete().eq('product_id', productId);
  const { error } = await admin.from('products').delete().eq('slug', slug);
  expect(error).toBeNull();
});

function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /hydration|server rendered|didn't match/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function emulateEmailObfuscation(page: Page): Promise<void> {
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch({ maxRedirects: 0 });
    let body = await response.text();
    if (!response.headers()['cache-control']?.split(',').some(value => value.trim() === 'no-transform')) {
      body = body.replaceAll(`>Course ${email}<`, '>Course <span class="__cf_email__" data-cfemail="fixture">[email protected]</span><');
    }
    await route.fulfill({ response, body });
  });
}

for (const locale of ['pl', 'en'] as const) {
  test(`${locale}: coupon entry works before hydration and retains its state afterwards`, async ({ page }) => {
    const errors = collectHydrationErrors(page);
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
    await page.route('**/_next/static/**/*.js', async route => {
      await scriptsReady;
      await route.continue();
    });
    try {
      await page.goto(`/${locale}/p/${slug}?coupon=${couponCode}`, { waitUntil: 'commit' });
      const input = page.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code', exact: true });
      await expect(input).toBeVisible();
      await expect(input).toHaveValue(couponCode);
      await expect(input).toBeDisabled();
      releaseScripts();
      await expect(page.getByText(new RegExp(`(?:Discount|Rabat).*${couponCode}`)).first()).toBeVisible();
      await expect(input).toHaveValue(couponCode);
      await expect(input).toBeDisabled();
      await expect(page.getByText(locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?', { exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      releaseScripts();
    }
  });

  test(`${locale}: public pages hydrate through document delivery across browser locale and timezone`, async ({ page }) => {
    const errors = collectHydrationErrors(page);
    await emulateEmailObfuscation(page);
    for (const path of [`/${locale}`, `/${locale}/store`, `/${locale}/p/${slug}`, `/${locale}/p/premium-course`, `/${locale}/p/free-tutorial`]) {
      const response = await page.goto(path, { waitUntil: 'networkidle' });
      expect(response?.status(), path).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(errors, path).toEqual([]);
      expect(response?.headers()['cache-control'], path).toMatch(/\bno-transform\b/);
      if (path.endsWith(slug)) {
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Course ${email}`);
        await expect(page.getByText(/2099.*12:30.*UTC/)).toBeVisible();
      }
    }
  });
}

test('private page redirects retain document delivery directives', async ({ request }) => {
  for (const path of ['/pl/dashboard/affiliates', '/pl/admin/templates/history', '/template-preview/2']) {
    const response = await request.get(path, { maxRedirects: 0, headers: { accept: 'text/html' } });
    expect(response.status()).toBe(307);
    expect(response.headers()['cache-control']).toContain('private');
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['cache-control']).toContain('no-transform');
  }
});
