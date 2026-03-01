/**
 * WCAG 2.x AA Accessibility Tests
 *
 * Runs axe-core against all major pages in both light and dark themes.
 * Uses @axe-core/playwright for Playwright-native integration.
 *
 * Run: bun run test:a11y
 */
import { test, Page } from '@playwright/test';
import { createTestAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { checkAccessibility } from './helpers/axe';

test.setTimeout(120_000);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || LOCAL_ANON_KEY;

// ===== SHARED STATE =====

let adminEmail: string;
let adminPassword: string;
let cleanup: () => Promise<void>;

// Third-party selectors excluded from all checks
const THIRD_PARTY_EXCLUDES = ['#klaro', 'iframe[src*="stripe"]', '[data-turnstile]', '.__PrivateStripeElement', '.__PrivateStripeElementLoader'];

// ===== SETUP / TEARDOWN =====

test.beforeAll(async () => {
  const admin = await createTestAdmin('a11y');
  adminEmail = admin.email;
  adminPassword = admin.password;
  cleanup = admin.cleanup;
});

test.afterAll(async () => {
  await cleanup();
});

// ===== HELPERS =====

async function signIn(page: Page) {
  await acceptAllCookies(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
    // @ts-ignore - dynamic ESM import works in browser context
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    await supabase.auth.signInWithPassword({ email, password });
  }, {
    email: adminEmail,
    password: adminPassword,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
  });
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem('gf_theme', t);
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, theme);
}

async function visitAndCheck(
  page: Page,
  path: string,
  options?: { excludeSelectors?: string[]; excludeRules?: string[] }
) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await checkAccessibility(page, {
    excludeSelectors: [...THIRD_PARTY_EXCLUDES, ...(options?.excludeSelectors || [])],
    excludeRules: options?.excludeRules,
  });
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
