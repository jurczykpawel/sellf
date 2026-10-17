import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

let script: string;
let origin: string;
let attempts: Array<Record<string, unknown>> = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url!, 'http://localhost');
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(script); return; }
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/create-payment-intent') {
      attempts.push(body);
      response.end(JSON.stringify(body.expireOnly ? { success: true } : { clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first' }));
    } else response.end(JSON.stringify(url.pathname === '/api/validate-email' ? { success: true, data: { isValid: true } } : { success: true }));
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(url.pathname === '/'
    ? '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
    : '<!doctype html><html><head><meta charset="utf-8"></head><body>Checkout left</body></html>');
});
test.beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-checkout-'));
  const mocks = [
    'next/navigation', '@stripe/react-stripe-js/checkout', '@/lib/actions/checkout', '@/lib/stripe/client',
    '@/contexts/AuthContext', '@/components/providers/config-provider', '@/components/providers/theme-provider',
    '@/hooks/useTracking', '@/hooks/useOrderBumps', '@/hooks/useOto', '@/hooks/useFreeAccess', '@/hooks/useCheckoutRedirect',
    '@/hooks/useCoupon', '@/hooks/useInvoiceData', '@/components/DemoCheckoutNotice', '@/components/checkout/InvoiceFields', './ProductShowcase',
  ];
  try {
    execFileSync('bun', ['-e', `
      const mocked = new Set(${JSON.stringify(mocks)});
      const result = await Bun.build({entrypoints:['tests/fixtures/storefront-sections/checkout-browser.tsx'], target:'browser', define:{'process.env':'{}'}, outdir:${JSON.stringify(directory)}, plugins:[{name:'checkout-fixture',setup(build){build.onResolve({filter:/.*/}, args => mocked.has(args.path) ? {path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/checkout-runtime.tsx'))}} : undefined);}}]});
      if(!result.success) throw new AggregateError(result.logs);
    `]);
    script = readFileSync(path.join(directory, 'checkout-browser.js'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

for (const locale of ['en', 'pl']) for (const outcome of ['leave', 'redirect', 'decline']) {
  test(`${locale}: checkout ${outcome} retires only unpaid attempts`, async ({ page }) => {
    const errors: string[] = [];
    attempts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/?locale=${locale}${outcome === 'decline' ? '&decline' : ''}`);
    expect(errors).toEqual([]);
    const continueButton = page.locator('button[type="submit"]');
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toHaveText(locale === 'pl' ? 'Przejdź do płatności' : 'Continue to payment');
    expect(attempts).toEqual([]);
    await continueButton.click();
    await expect(page.getByTestId('payment-fields')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText(locale === 'pl' ? /Zapłać.*49/ : /Pay.*49/);
    expect(attempts).toHaveLength(1);
    if (outcome !== 'leave') {
      await page.locator('#checkoutEmail').fill('buyer@example.com');
      await page.locator('#fullName').fill('Test Buyer');
      await page.locator('button[type="submit"]').click();
      if (outcome === 'redirect') await expect(page).toHaveURL(`${origin}/confirmed`);
      else await expect(page.getByText('Choose another payment method')).toBeVisible();
    }
    if (outcome !== 'redirect') {
      await page.getByRole('link', { name: 'Leave checkout' }).click();
      await expect(page).toHaveURL(`${origin}/left`);
      await expect.poll(() => attempts.filter(attempt => attempt.expireOnly)).toHaveLength(1);
      await page.goBack();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expect(page.getByTestId('payment-fields')).toHaveCount(0);
      expect(attempts).toHaveLength(2);
    } else {
      expect(attempts.filter(attempt => attempt.expireOnly)).toEqual([]);
      await page.goBack();
      await expect(page.locator('button[type="submit"]')).toHaveText(locale === 'pl' ? 'Przejdź do płatności' : 'Continue to payment');
      await expect(page.getByTestId('payment-fields')).toHaveCount(0);
      const retiredBeforeNewAttempt = attempts.filter(attempt => attempt.expireOnly).length;
      await continueButton.click();
      await expect(page.getByTestId('payment-fields')).toBeVisible();
      await page.getByRole('link', { name: 'Leave checkout' }).click();
      await expect.poll(() => attempts.filter(attempt => attempt.expireOnly)).toHaveLength(retiredBeforeNewAttempt + 1);
    }
    expect(errors).toEqual([]);
  });
}
