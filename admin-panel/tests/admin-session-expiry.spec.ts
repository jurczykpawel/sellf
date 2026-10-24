/**
 * Shared session recovery in a browser with a local route fixture.
 * @see tests/fixtures/admin-session-browser.tsx
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
let script: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-session-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/admin-session-browser.tsx', '--target=browser', '--define', 'process.env={}', '--outdir', directory]);
    script = readFileSync(path.join(directory, 'admin-session-browser.js'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const locale of ['en', 'pl']) {
  for (const recovered of [true, false]) {
    test(`${locale}: DELETE ${recovered ? 'recovers after refresh' : 'shows login link after persistent 401'}`, async ({ page }) => {
      let attempts = 0;
      let refreshes = 0;
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://session.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
        if (url.pathname === '/api/runtime-config') return route.fulfill({ json: { supabaseUrl: 'https://session.test', supabaseAnonKey: 'fixture-key' } });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: 'admin', aud: 'authenticated', role: 'authenticated', email: 'admin@example.com' } });
        if (url.pathname === '/auth/v1/token') {
          refreshes++;
          const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"admin","exp":4102444800}').toString('base64url')}.c2lnbmF0dXJl`;
          return route.fulfill({ json: { access_token: token, refresh_token: 'renewed-fixture', expires_in: 3600, token_type: 'bearer', user: { id: 'admin' } } });
        }
        if (url.pathname === '/api/v1/webhooks') return route.fulfill({ json: { data: [], pagination: { has_more: false } } });
        if (url.pathname === '/api/v1/webhooks/endpoint') {
          attempts++;
          expect(route.request().method()).toBe('DELETE');
          if (recovered && attempts === 2) return route.fulfill({ status: 204 });
          return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } } });
        }
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>' });
      });
      await page.goto(`https://session.test/?locale=${locale}`);
      await page.getByRole('button', { name: 'Delete webhook' }).click();
      await expect(page.locator('output')).toHaveText(recovered ? 'Deleted' : 'Retained');
      expect(attempts).toBe(2);
      expect(refreshes).toBe(1);
      if (!recovered) {
        const notice = page.locator('[data-sonner-toast]').filter({ has: page.getByRole('link') });
        await expect(notice).toContainText(locale === 'pl' ? 'Sesja wygasła — zaloguj się ponownie' : 'Session expired — sign in again');
        await expect(page.getByRole('link', { name: locale === 'pl' ? 'Zaloguj' : 'Login' })).toHaveAttribute('href', `/${locale}/login`);
      }
      expect(errors).toEqual([]);
    });
  }
}
