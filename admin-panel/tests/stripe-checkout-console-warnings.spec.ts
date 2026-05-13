/**
 * Stripe Custom Checkout — real-time console warnings regression guard.
 *
 * This is the ONLY test that catches Stripe SDK contract violations from the
 * live runtime. Source-level tests pin the patterns we *think* Stripe wants,
 * but Stripe alone is authoritative — and several of its rules (e.g. paired
 * collection of country + postalCode) are not easy to encode from grepping
 * source.
 *
 * Production incidents this test would have prevented:
 *   - "You cannot provide `returnUrl` to confirm() when `return_url` was
 *     already provided when creating the Checkout Session."
 *   - "You cannot provide `billingAddress` in confirm() when using automatic
 *     tax. Please use updateBillingAddress() instead."
 *   - "You previously passed billingAddress.address.country to
 *     updateBillingAddress(), but Payment Element may also be collecting this
 *     field..."
 *   - "You cannot pass both billingAddress.address.country to
 *     updateBillingAddress() and fields.billingDetails.address.country=never
 *     [...] without also passing fields.billingDetails.address.postalCode=never
 *     [...]" — Stripe paired collection rule.
 *   - "Unrecognized payment.update() parameter: layout.defaultCollapsed".
 *
 * Strategy: open a real subscription checkout, fill required fields, click Pay,
 * then assert that *no* Stripe console warning matches any of the forbidden
 * patterns. We capture both top-frame console (`page.on('console')`) and CDP
 * `Runtime.consoleAPICalled` so inner Stripe iframes are included.
 */

import { test, expect, type CDPSession } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

test.describe.configure({ mode: 'serial' });

let productId = '';
let productSlug = '';

const FORBIDDEN_WARNING_PATTERNS: RegExp[] = [
  /cannot provide ['"`]returnUrl['"`]/i,
  /cannot provide ['"`]billingAddress['"`]/i,
  /cannot provide ['"`]email['"`]/i,
  /double collecting billing details/i,
  /You previously passed billingAddress\./i,
  /You cannot pass both billingAddress\./i,
  /defaultCollapsed/i,
  /Unrecognized payment\.update\(\) parameter/i,
  /Unrecognized paymentElement\.update\(\) parameter/i,
];

// Whitelist for warnings we knowingly accept (dev-only / external):
const IGNORED_WARNING_PATTERNS: RegExp[] = [
  /test your Stripe\.js integration over HTTP/i, // dev http vs https
  /payment method types are not activated/i,     // dashboard pre-launch config
  // Stripe SDK internally calls paymentElement.update({ applePay: { recurringPaymentRequest: {...} } })
  // for subscription mode, but `applePay` is not a recognized `update()` parameter.
  // Informational only — does not block payment flow. Re-check after Stripe SDK upgrades.
  /applePay\.recurringPaymentRequest\.billingAgreement/i,
  // Apple Pay / Google Pay require domain verification in Stripe Dashboard.
  // For TSA the domain is not verified, so wallets are hidden in UI — Stripe
  // logs an informational warning. Dashboard config, not our code.
  /domain.*not.*verified|not.*registered.*verified.*domain/i,
];

test.beforeAll(async () => {
  const { data: product, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: 'Stripe Warning Regression Sub',
      slug: `stripe-warning-sub-${Date.now()}`,
      description: 'Regression fixture — assert no Stripe console warnings',
      is_active: true,
      icon: '🛡️',
      price: 0,
      currency: 'PLN',
      product_type: 'subscription',
      recurring_price: 99,
      billing_interval: 'month',
      billing_interval_count: 1,
    })
    .select('id, slug')
    .single();
  if (error || !product) throw new Error('Failed to create test product: ' + error?.message);
  productId = product.id;
  productSlug = product.slug;
});

test.afterAll(async () => {
  if (productId) {
    await supabaseAdmin.from('products').delete().eq('id', productId);
  }
});

test('subscription Pay click produces NO Stripe contract warnings in console', async ({ page }) => {
  const allMessages: { type: string; text: string }[] = [];

  page.on('console', (msg) => {
    allMessages.push({ type: `page:${msg.type()}`, text: msg.text() });
  });

  // Stripe iframes log to their own context — pipe them in via CDP.
  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send('Runtime.enable');
  client.on('Runtime.consoleAPICalled', (event) => {
    const text = event.args
      .map((a) => String((a as { value?: unknown; description?: unknown }).value ?? (a as { description?: unknown }).description ?? ''))
      .join(' ');
    allMessages.push({ type: `cdp:${event.type}`, text });
  });

  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${productSlug}`);
  await page.waitForLoadState('domcontentloaded');

  // Minimal happy-path fill — enough to reach checkout.confirm() in the SDK.
  await expect(page.locator('input#checkoutEmail')).toBeVisible({ timeout: 30000 });
  await page.locator('input#checkoutEmail').fill(`stripe-warn-${Date.now()}@gmail.com`);
  await page.locator('input#fullName').fill('Stripe Warning Buyer');
  await page.locator('input[type="checkbox"]').first().check();

  await expect(
    page.getByRole('button', { name: /Subskrybuj|Subscribe|Zapłać|Pay/i }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeAttached({
    timeout: 30000,
  });

  // Give Stripe time to attach its iframes + finish initial post-mount logging.
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Subskrybuj|Subscribe|Zapłać|Pay/i }).click();
  // Stripe warnings fire as the SDK processes confirm() — give it time to log.
  await page.waitForTimeout(4000);

  const offenders = allMessages.filter(
    ({ text }) =>
      FORBIDDEN_WARNING_PATTERNS.some((p) => p.test(text)) &&
      !IGNORED_WARNING_PATTERNS.some((p) => p.test(text)),
  );

  if (offenders.length > 0) {
    // Surface every offender so the developer fixes them all in one cycle
    // rather than playing whack-a-mole.
    const formatted = offenders
      .map(({ type, text }) => `  [${type}] ${text}`)
      .join('\n');
    throw new Error(
      `Stripe contract warning(s) detected in console:\n${formatted}\n\n` +
        `These are runtime contract violations — fix CustomPaymentForm and ` +
        `re-run this spec until clean.`,
    );
  }

  expect(offenders).toEqual([]);
});
