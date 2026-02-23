import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { loginAsAdmin } from './helpers/admin-auth';

/**
 * Color Migration Verification
 * Ensures no hardcoded purple/pink Tailwind classes remain in the rendered DOM.
 * Allowed exception: Yahoo email provider brand color in LoginForm.
 * @see lib/themes/index.ts for the gf-*/wl-* token system
 */

// Regex to match hardcoded purple/pink Tailwind classes in HTML class attributes
// Matches patterns like: purple-50, purple-600, pink-500, etc.
const PURPLE_PINK_CLASS_REGEX = /\b(?:purple|pink)-\d{2,3}\b/;

// Hex colors that should no longer appear in inline styles
const FORBIDDEN_HEX_COLORS = ['#9333ea', '#ec4899', '#8b5cf6', '#a855f7', '#d946ef'];

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
    ({ regex, forbiddenHex, allowYahoo }) => {
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

      // Check inline styles for forbidden hex colors
      const allWithStyle = document.querySelectorAll('[style]');
      for (const el of allWithStyle) {
        const style = el.getAttribute('style') || '';
        for (const hex of forbiddenHex) {
          if (style.toLowerCase().includes(hex)) {
            found.push(`inline style="${hex}" on <${el.tagName.toLowerCase()}>`);
          }
        }
      }

      return found;
    },
    {
      regex: PURPLE_PINK_CLASS_REGEX.source,
      forbiddenHex: FORBIDDEN_HEX_COLORS,
      allowYahoo: options?.allowYahooPurple ?? false,
    }
  );

  return violations;
}

test.describe('Color Migration — No Hardcoded Purple/Pink', () => {
  test.describe.configure({ mode: 'serial' });

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
    await loginAsAdmin(page);

    for (const url of ADMIN_PAGES) {
      const violations = await checkPageForViolations(page, url);

      expect(violations, `Found purple/pink on ${url}: ${violations.join(', ')}`).toHaveLength(0);
    }
  });
});
