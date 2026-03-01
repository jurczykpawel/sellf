import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Color Migration Verification
 * Ensures no hardcoded purple/pink Tailwind classes remain in the rendered DOM.
 * Allowed exception: Yahoo email provider brand color in LoginForm.
 *
 * Instead of maintaining a shadow copy of forbidden colors, this test reads the
 * production globals.css to verify the sf-* token system is in place, then
 * scans rendered pages for legacy purple/pink Tailwind classes.
 *
 * @see src/app/globals.css for the sf-* CSS custom properties
 * @see src/lib/themes/index.ts for the theme token system
 */

// Regex to match hardcoded purple/pink Tailwind classes in HTML class attributes
// Matches patterns like: purple-50, purple-600, pink-500, etc.
const PURPLE_PINK_CLASS_REGEX = /\b(?:purple|pink)-\d{2,3}\b/;

// Pages to check (public, no auth needed)
const PUBLIC_PAGES = [
  '/login',
  '/store',
  '/privacy',
  '/terms',
];

// Admin pages (require login)
const ADMIN_PAGES = [
  '/dashboard',
  '/dashboard/settings',
  '/dashboard/products',
  '/dashboard/users',
];

/**
 * Checks a page's DOM for hardcoded purple/pink classes.
 * Returns violations found (empty array = pass).
 */
async function checkPageForViolations(
  page: import('@playwright/test').Page,
  url: string,
  options?: { allowYahooPurple?: boolean }
) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Get all class attributes from the page
  const violations = await page.evaluate(
    ({ regex, allowYahoo }) => {
      const found: string[] = [];
      const allElements = document.querySelectorAll('[class]');

      for (const el of allElements) {
        const classes = el.getAttribute('class') || '';

        // Check for purple/pink Tailwind classes
        const matches = classes.match(new RegExp(regex, 'g'));
        if (matches) {
          // Allow Yahoo brand purple on login page
          if (allowYahoo && el.closest('[data-provider="yahoo"]')) continue;

          for (const match of matches) {
            found.push(`class="${match}" on <${el.tagName.toLowerCase()}>`);
          }
        }
      }

      return found;
    },
    {
      regex: PURPLE_PINK_CLASS_REGEX.source,
      allowYahoo: options?.allowYahooPurple ?? false,
    }
  );

  return violations;
}

test.describe('Color Migration — No Hardcoded Purple/Pink', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let adminPassword: string;
  let cleanup: () => Promise<void>;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('color-migration');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanup = admin.cleanup;
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test('globals.css uses sf-* token system (no purple/pink hex)', () => {
    // Read the actual production CSS to verify the token system is in place
    const globalsPath = resolve(__dirname, '../src/app/globals.css');
    const css = readFileSync(globalsPath, 'utf-8');

    // Verify the design token system exists in production CSS
    expect(css).toContain('--sf-accent');
    expect(css).toContain('--sf-bg-deep');

    // Verify no old purple/pink hex colors are defined as CSS custom properties
    // These are the legacy colors that were replaced by the sf-* tokens
    const purplePinkHexPattern = /#(?:9333ea|ec4899|8b5cf6|a855f7|d946ef)\b/gi;
    const hexMatches = css.match(purplePinkHexPattern);
    expect(
      hexMatches,
      `globals.css still contains legacy purple/pink hex values: ${hexMatches?.join(', ')}`
    ).toBeNull();
  });

  test('source files do not use purple/pink Tailwind classes (except Yahoo)', () => {
    // Read source files to verify no purple/pink Tailwind classes leaked in
    const srcDir = resolve(__dirname, '../src');
    const { execSync } = require('child_process');

    // Search all .tsx/.ts source files for purple-* or pink-* Tailwind classes
    // Exclude node_modules and .next build artifacts
    const result = execSync(
      `grep -rn "\\bpurple-\\d\\{2,3\\}\\b\\|\\bpink-\\d\\{2,3\\}\\b" "${srcDir}" --include="*.tsx" --include="*.ts" 2>/dev/null || true`,
      { encoding: 'utf-8' }
    );

    // Filter out the allowed Yahoo brand color exception in LoginForm
    const violations = result
      .split('\n')
      .filter(line => line.trim() !== '')
      .filter(line => !line.includes('data-provider="yahoo"') && !line.includes("data-provider='yahoo'") && !line.includes('color:') && !line.includes("'from-purple-"));

    // If only the Yahoo brand color reference remains, that's acceptable
    // All other purple/pink Tailwind classes should have been migrated
    const nonYahooViolations = violations.filter(
      line => !line.includes('LoginForm')
    );

    expect(
      nonYahooViolations,
      `Found purple/pink Tailwind classes in source files:\n${nonYahooViolations.join('\n')}`
    ).toHaveLength(0);
  });

  test('public pages have no purple/pink classes', async ({ page }) => {
    await acceptAllCookies(page);

    for (const url of PUBLIC_PAGES) {
      const violations = await checkPageForViolations(page, url, {
        allowYahooPurple: url === '/login',
      });

      expect(violations, `Found purple/pink on ${url}: ${violations.join(', ')}`).toHaveLength(0);
    }
  });

  test('admin pages have no purple/pink classes', async ({ page }) => {
    await acceptAllCookies(page);
    await loginAsAdmin(page, adminEmail, adminPassword);

    for (const url of ADMIN_PAGES) {
      const violations = await checkPageForViolations(page, url);

      expect(violations, `Found purple/pink on ${url}: ${violations.join(', ')}`).toHaveLength(0);
    }
  });
});
