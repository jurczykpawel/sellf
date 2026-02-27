/**
 * Lightweight visual screenshot test — navigates all important pages for AI review.
 *
 * Unlike full E2E tests, this file only does page.goto() + wait.
 * No form filling, no complex interactions. Playwright's `screenshot: 'on'`
 * (configured in visual-* projects) captures each page automatically.
 *
 * Run: bun run test:visual
 * Review: bun run test:visual:review
 */
import { test, Page } from '@playwright/test';
import { createTestAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

// Each test navigates many pages — need more time than default 30s
test.setTimeout(120_000);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || LOCAL_ANON_KEY;

let adminEmail: string;
let adminPassword: string;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
  const admin = await createTestAdmin('visual');
  adminEmail = admin.email;
  adminPassword = admin.password;
  cleanup = admin.cleanup;
});

test.afterAll(async () => {
  await cleanup();
});

/**
 * Sign in via Supabase client-side auth without waiting for sidebar.
 * Unlike loginAsAdmin(), this works at any viewport (mobile sidebar is hidden).
 */
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

/** Navigate to a page and wait for it to render */
async function visitPage(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  // Short settle time for React hydration and lazy-loaded content
  await page.waitForTimeout(1000);
}

test('public pages', async ({ page }) => {
  await acceptAllCookies(page);

  const publicPages = [
    '/',
    '/login',
    '/p/premium-course',
    '/checkout/free-tutorial',
    '/checkout/premium-course',
  ];

  for (const path of publicPages) {
    await visitPage(page, path);
  }
});

test('admin dashboard pages', async ({ page }) => {
  await signIn(page);

  const adminPages = [
    '/dashboard',
    '/dashboard/products',
    '/dashboard/variants',
    '/dashboard/categories',
    '/dashboard/order-bumps',
    '/dashboard/coupons',
    '/dashboard/refund-requests',
    '/dashboard/webhooks',
    '/dashboard/integrations',
    '/dashboard/api-keys',
    '/dashboard/users',
    '/dashboard/payments',
    '/dashboard/settings',
  ];

  for (const path of adminPages) {
    await visitPage(page, path);
  }
});

test('user pages', async ({ page }) => {
  await signIn(page);

  const userPages = [
    '/my-products',
    '/my-purchases',
    '/profile',
  ];

  for (const path of userPages) {
    await visitPage(page, path);
  }
});
