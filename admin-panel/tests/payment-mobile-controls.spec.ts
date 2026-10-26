/** The registered Stripe controls use the public-domain layout without contacting Stripe. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
let script: string;
let css: string;
test.beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-payment-mobile-'));
  try {
    execFileSync('bun', ['-e', `
      const result = await Bun.build({ entrypoints: ['tests/fixtures/storefront-sections/payment-mobile-browser.tsx'], target: 'browser', outdir: ${JSON.stringify(directory)}, plugins: [{
        name: 'fixture-actions', setup(builder) {
          builder.onLoad({ filter: /lib\\/actions\\/stripe-config\\.ts$/ }, () => ({ loader: 'js', contents: 'export const listStripeConfigs = async () => ({success:true, data:[]}); export const getStripeAccountInfo = async () => null; export const getStripeKeySource = async () => ({ activeSource:"env", envConfigured:true, dbConfigured:false }); export const getWebhookRegistrationInfo = async () => ({status:"registered",endpointId:"we_1SRg3uCIdCxZlZxRY8gJfZ0R"}); export const createStripeWebhookEndpoint = async () => ({});' }));
          builder.onLoad({ filter: /contexts\\/AuthContext\\.tsx$/ }, () => ({ loader: 'js', contents: 'export const useAuth = () => ({role:"platform_admin"});' }));
          builder.onLoad({ filter: /components\\/stripe\\/StripeConfigWizard\\.tsx$/ }, () => ({ loader: 'js', contents: 'export const StripeConfigWizard = () => null;' }));
        }
      }] });
      if (!result.success) throw new Error(result.logs.map(String).join('\\n'));
    `]);
    script = readFileSync(path.join(directory, 'payment-mobile-browser.js'), 'utf8');
    css = (await postcss([tailwindcss()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const locale of ['pl', 'en']) {
  test(`${locale}: registered webhook controls fit 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('http://payment.test/**', route => route.fulfill(route.request().url().endsWith('/fixture.js')
      ? { contentType: 'application/javascript', body: script }
      : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${css}</style></head><body><main id="root" style="padding:24px"></main><script src="/fixture.js"></script></body></html>` }));
    await page.goto(`http://payment.test/?locale=${locale}`);
    const button = page.getByRole('button', { name: locale === 'pl' ? 'Ponownie zarejestruj' : 'Re-register' });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
}
