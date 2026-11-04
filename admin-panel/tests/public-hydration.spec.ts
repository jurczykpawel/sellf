import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';

const slug = `public-hydration-${Date.now()}`;
const email = 'contact@example.com';
const couponCode = `HYDRATE${randomUUID().slice(0, 8).toUpperCase()}`;
let productId: string;
let couponId: string;
let profileProductId: string;
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test.beforeAll(async () => {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.SUPABASE_URL!).hostname);
  const { data, error } = await admin.from('products').insert({
    slug, name: `Course ${email}`, description: 'Hydration fixture',
    price: 49, currency: 'PLN', is_active: true, is_listed: true,
    sale_price: 25, sale_price_until: '2099-10-17T12:30:00Z',
  }).select('id').single();
  expect(error).toBeNull(); productId = data!.id;
  const profileProduct = await admin.from('products').insert({
    slug: `${slug}-profile`, name: 'Profile hydration', price: 49, currency: 'PLN', is_active: true,
    checkout_profile: { v: 1, modules: [
      { id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] },
      { id: 'recipient', for: ['organization'] }, { id: 'phone', required: true },
      { id: 'quantity', min: 1, max: 5, mode: 'checkout' },
      { id: 'participants', required: true, prefill_from_buyer: false },
    ] },
  }).select('id').single();
  expect(profileProduct.error).toBeNull(); profileProductId = profileProduct.data!.id;
  const coupon = await admin.from('coupons').insert({ code: couponCode, discount_type: 'percentage', discount_value: 10, is_active: true, allowed_product_ids: [productId] }).select('id').single();
  expect(coupon.error).toBeNull(); couponId = coupon.data!.id;
});
test.afterAll(async () => {
  if (couponId) {
    await admin.from('coupon_reservations').delete().eq('coupon_id', couponId);
    await admin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
    await admin.from('coupons').delete().eq('id', couponId);
  }
  if (profileProductId) {
    await admin.from('payment_transactions').delete().eq('product_id', profileProductId);
    const removed = await admin.from('products').delete().eq('id', profileProductId); expect(removed.error).toBeNull();
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
  test(`${locale}: profile controls become editable after hydration and retain buyer input`, async ({ page }) => {
    await acceptAllCookies(page);
    const errors = collectHydrationErrors(page);
    let releaseScripts!: () => void;
    const ready = new Promise<void>(resolve => { releaseScripts = resolve; });
    await page.route('**/_next/static/**/*.js', async route => { await ready; await route.continue(); });
    try {
      await page.goto(`/${locale}/checkout/${slug}-profile`, { waitUntil: 'commit' });
      const buyer = page.locator('[id="buyer.type"]');
      await expect(buyer).toBeVisible();
      const controls = page.locator('fieldset input, fieldset select, #phone, #checkoutQuantity');
      expect(await controls.count()).toBeGreaterThan(5);
      for (const control of await controls.all()) await expect(control).toBeDisabled();
      releaseScripts();
      await expect(buyer).toBeEnabled();
      await buyer.selectOption('organization');
      await page.locator('[id="buyer.first_name"]').fill('Jan');
      await page.locator('[id="buyer.company_name"]').fill('Example workshop');
      await page.locator('#phone').fill('500100200');
      await page.locator('#checkoutQuantity').fill('2');
      const recipient = page.getByRole('checkbox', { name: locale === 'pl' ? 'Inny odbiorca' : 'Different recipient' });
      await recipient.check();
      await page.locator('[id="recipient.city"]').fill('Warszawa');
      await page.locator('[id="participants.0.first_name"]').fill('Ala');
      await expect(page.locator('[id="participants.1.first_name"]')).toBeEnabled();
      await expect(buyer).toHaveValue('organization');
      await expect(page.locator('[id="buyer.first_name"]')).toHaveValue('Jan');
      await expect(page.locator('[id="buyer.company_name"]')).toHaveValue('Example workshop');
      await expect(page.locator('[id="recipient.city"]')).toHaveValue('Warszawa');
      await expect(page.locator('[id="participants.0.first_name"]')).toHaveValue('Ala');
      await expect(page.locator('#phone')).toHaveValue('500100200');
      expect(errors).toEqual([]);
    } finally { releaseScripts(); }
  });

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
      // Not networkidle: paid product pages embed Stripe.js, whose beacons and iframes keep the network busy
      // for as long as Stripe likes (big-r43 and locally: >60 s). React marks every node it hydrated; waiting
      // for that on the server-rendered h1 is the hydration signal itself.
      const response = await page.goto(path, { waitUntil: 'load' });
      expect(response?.status(), path).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForFunction(() => {
        const h1 = document.querySelector('h1');
        return !!h1 && Object.keys(h1).some(key => key.startsWith('__reactFiber$'));
      });
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
