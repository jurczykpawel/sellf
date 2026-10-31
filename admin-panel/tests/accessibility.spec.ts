/**
 * WCAG 2.x AA Accessibility Tests
 *
 * Runs axe-core against all major pages in both light and dark themes.
 * Uses @axe-core/playwright for Playwright-native integration.
 *
 * Run: bun run test:a11y
 */
import { randomUUID } from 'node:crypto';
import { expect, Page } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { checkAccessibility } from './helpers/axe';
import { readRawActiveTheme, writeActiveTheme, restoreRawActiveTheme } from './helpers/active-theme';
import { THEME_PRESETS } from '@/lib/themes';
import { test, startNativeCheckout } from './helpers/checkout-intent';

test.setTimeout(120_000);

// ===== SHARED STATE =====

let adminEmail: string;
let adminPassword: string;
let cleanup: () => Promise<void>;
let partialRefundId: string;
const partialRefundEmail = `a11y-partial-${randomUUID()}@example.com`;

// Third-party selectors excluded from all checks
const THIRD_PARTY_EXCLUDES = ['#cc-main', 'iframe[src*="stripe"]', '[data-turnstile]', 'altcha-widget', '.__PrivateStripeElement', '.__PrivateStripeElementLoader'];

// ===== SETUP / TEARDOWN =====

test.beforeAll(async () => {
  const admin = await createTestAdmin('a11y');
  adminEmail = admin.email;
  adminPassword = admin.password;
  cleanup = admin.cleanup;
  const product = await supabaseAdmin.from('products').select('id').eq('slug', 'premium-course').single();
  expect(product.error).toBeNull();
  const payment = await supabaseAdmin.from('payment_transactions').insert({
    session_id: `cs_a11y_${randomUUID().replaceAll('-', '')}`, product_id: product.data!.id,
    customer_email: partialRefundEmail, amount: 10000, refunded_amount: 2500, currency: 'USD', status: 'completed',
  }).select('id').single();
  expect(payment.error).toBeNull(); partialRefundId = payment.data!.id;
});

test.afterAll(async () => {
  if (partialRefundId) expect((await supabaseAdmin.from('payment_transactions').delete().eq('id', partialRefundId)).error).toBeNull();
  await cleanup();
});

// ===== HELPERS =====

async function signIn(page: Page) {
  await acceptAllCookies(page);
  await setAuthSession(page, adminEmail, adminPassword);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem('sf_theme', t);
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, theme);
}

/**
 * Some submit buttons stay disabled (`disabled:opacity-50` + `transition-all`)
 * until an async readiness check resolves — e.g. the checkout pay button is
 * disabled (and isn't even mounted yet while the session is being created)
 * until Stripe's embedded Checkout session finishes loading. The instant
 * readiness resolves, React drops the `disabled` attribute and a CSS opacity
 * transition starts animating the button back to full visibility. Sampling
 * color contrast during that window — button enabled (no longer exempt from
 * the color-contrast check) but still mid-fade — reads as a transient,
 * non-representative violation.
 *
 * Being "currently disabled" isn't by itself proof of a settled state: a
 * button can be disabled-while-loading one instant and enabled-and-animating
 * the next, so inferring readiness from opacity/attribute timing alone is
 * racy under load. `CustomPaymentForm` instead marks that exact condition
 * explicitly with an inert `data-checkout-pending` attribute (present only
 * while `checkoutResult.type !== 'success'`) — this waits on that real signal
 * rather than guessing from CSS timing, then waits for the resulting opacity
 * transition to finish.
 *
 * `document.querySelectorAll('button[type="submit"]')` is empty before such a
 * button mounts, so a naive `.every(...)` over it is vacuously true and would
 * resolve before the button ever appears — this watches for DOM mutations
 * (the button mounting) and only evaluates "settled" once mutations have been
 * quiet for a beat, so it can't short-circuit on an element that simply
 * doesn't exist yet. Best-effort: pages with continuous background DOM
 * activity (polling, live counters) may never go fully quiet, so this gives
 * up after a bounded timeout rather than hanging the whole suite.
 */
async function waitForSettledButtonStates(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __sfLastMutationAt?: number };
    w.__sfLastMutationAt = Date.now();
    const observer = new MutationObserver(() => {
      w.__sfLastMutationAt = Date.now();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['disabled', 'data-checkout-pending'],
      childList: true,
      subtree: true,
    });
    setTimeout(() => observer.disconnect(), 15_000);
  });

  try {
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __sfLastMutationAt?: number };
        if (Date.now() - (w.__sfLastMutationAt ?? 0) < 250) return false;
        const buttons = document.querySelectorAll('button[type="submit"]');
        return Array.from(buttons).every((button) => {
          const el = button as HTMLButtonElement;
          if (el.hasAttribute('data-checkout-pending')) return false;
          return el.disabled || parseFloat(getComputedStyle(el).opacity) >= 0.99;
        });
      },
      undefined,
      { timeout: 10_000 }
    );
  } catch {
    // Best-effort — fall through to the existing checks rather than failing
    // the whole page visit on an unrelated timeout.
  }
}

async function visitAndCheck(
  page: Page,
  path: string,
  options?: { excludeSelectors?: string[]; excludeRules?: string[] }
) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await waitForSettledButtonStates(page);
  if (path === '/dashboard/payments') {
    const row = page.getByRole('row').filter({ hasText: partialRefundEmail });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Partially refunded.*25\.00/)).toBeVisible();
  }
  await checkAccessibility(page, {
    excludeSelectors: [...THIRD_PARTY_EXCLUDES, ...(options?.excludeSelectors || [])],
    excludeRules: options?.excludeRules,
  });
  if (path === '/p/premium-course' || path === '/checkout/premium-course') {
    await expect(page.getByRole('button', { name: /^(Continue to payment|Przejdź do płatności)$/ })).toHaveCount(0);
    await startNativeCheckout(page);
    await expect(page.locator('input#fullName')).toBeVisible({ timeout: 30000 });
    await waitForSettledButtonStates(page);
    await checkAccessibility(page, {
      excludeSelectors: [...THIRD_PARTY_EXCLUDES, ...(options?.excludeSelectors || [])],
      excludeRules: options?.excludeRules,
    });
  }
}

// ===== PUBLIC PAGES =====

const publicPages = [
  { name: 'landing /', path: '/' },
  { name: 'store /store', path: '/store' },
  { name: 'product /p/premium-course', path: '/p/premium-course' },
  { name: 'checkout /checkout/premium-course', path: '/checkout/premium-course' },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Public pages - ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await acceptAllCookies(page);
      await setTheme(page, theme);
    });

    for (const { name, path } of publicPages) {
      test(name, async ({ page }) => {
        await visitAndCheck(page, path);
      });
    }
  });
}

// ===== PUBLIC PAGES — THEME PRESETS =====
// Shipped theme presets are a separate color system from the no-theme default
// above (see lib/themes/*.json + lib/themes/index.ts) — passing with no theme
// active says nothing about whether a preset itself reads at AA once a seller
// actually turns it on. Applies each preset for real via the same
// data/active-theme.json file the dev server reads per request (see
// helpers/active-theme.ts), runs the identical public-page axe check, then
// restores whatever theme (if any) was active before this file ran.

test.describe('Public pages — theme presets', () => {
  let originalActiveThemeRaw: string | null = null;

  test.beforeAll(async () => {
    originalActiveThemeRaw = await readRawActiveTheme();
  });

  test.afterAll(async () => {
    await restoreRawActiveTheme(originalActiveThemeRaw);
  });

  for (const { id, theme } of THEME_PRESETS) {
    for (const colorMode of ['light', 'dark'] as const) {
      test.describe(`${id} preset - ${colorMode} mode`, () => {
        test.beforeEach(async ({ page }) => {
          await writeActiveTheme(theme);
          await acceptAllCookies(page);
          await setTheme(page, colorMode);
        });

        for (const { name, path } of publicPages) {
          test(name, async ({ page }) => {
            await visitAndCheck(page, path);
          });
        }
      });
    }
  }
});

// ===== ADMIN PAGES =====

const adminPages = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'products', path: '/dashboard/products' },
  { name: 'payments', path: '/dashboard/payments' },
  { name: 'users', path: '/dashboard/users' },
  { name: 'coupons', path: '/dashboard/coupons' },
  { name: 'settings', path: '/dashboard/settings', excludeSelectors: ['[data-a11y-preview]'] },
  { name: 'webhooks', path: '/dashboard/webhooks' },
  { name: 'integrations', path: '/dashboard/integrations' },
  { name: 'api-keys', path: '/dashboard/api-keys' },
  { name: 'variants', path: '/dashboard/variants' },
  { name: 'categories', path: '/dashboard/categories' },
  { name: 'order-bumps', path: '/dashboard/order-bumps' },
  { name: 'refund-requests', path: '/dashboard/refund-requests' },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Admin pages - ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
      await setTheme(page, theme);
    });

    for (const { name, path, ...opts } of adminPages) {
      test(name, async ({ page }) => {
        await visitAndCheck(page, path, opts);
      });
    }
  });
}

// ===== USER PAGES =====

const userPages = [
  { name: 'my-products', path: '/my-products' },
  { name: 'my-purchases', path: '/my-purchases' },
  { name: 'profile', path: '/profile' },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`User pages - ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
      await setTheme(page, theme);
    });

    for (const { name, path } of userPages) {
      test(name, async ({ page }) => {
        await visitAndCheck(page, path);
      });
    }
  });
}
