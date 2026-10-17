import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

const slug = `public-hydration-${Date.now()}`;
const email = 'contact@example.com';
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test.beforeAll(async () => {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.SUPABASE_URL!).hostname);
  const { error } = await admin.from('products').insert({
    slug, name: `Course ${email}`, description: 'Hydration fixture',
    price: 49, currency: 'PLN', is_active: true,
    sale_price: 25, sale_price_until: '2099-10-17T12:30:00Z',
  });
  expect(error).toBeNull();
});
test.afterAll(async () => {
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
      await page.goto(`/${locale}/p/premium-course`, { waitUntil: 'commit' });
      await page.getByText(locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?', { exact: true }).click();
      const input = page.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code', exact: true });
      await expect(input).toBeVisible();
      await input.fill('save10');
      releaseScripts();
      await page.waitForLoadState('networkidle');
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('SAVE10');
      await input.fill('save20');
      await expect(input).toHaveValue('SAVE20');
      await page.getByText(locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?', { exact: true }).click();
      await expect(input).toBeHidden();
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
