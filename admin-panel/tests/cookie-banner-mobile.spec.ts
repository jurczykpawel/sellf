/** Section fixture, no servers: the consent banner must stay compact on phones and never cover page actions. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const lib = join(__dirname, '../node_modules/vanilla-cookieconsent/dist');
const globals = readFileSync(join(__dirname, '../src/app/globals.css'), 'utf8');
const compact = globals.slice(globals.indexOf('/* Cookie banner on narrow screens'));

for (const lang of ['pl', 'en'] as const) {
  test(`consent banner leaves the login button reachable at 390px (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('http://fixture.test/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><style>${readFileSync(join(lib, 'cookieconsent.css'), 'utf8')}${compact}</style>
<main style="padding:40px"><button id="login" style="margin-top:560px">Login</button></main><script>${readFileSync(join(lib, 'cookieconsent.umd.js'), 'utf8')}</script>` }));
    await page.goto('http://fixture.test/');
    await page.evaluate((language) => (window as any).CookieConsent.run({
      mode: 'opt-in', hideFromBots: false, guiOptions: { consentModal: { layout: 'box', position: 'bottom right' } },
      categories: { necessary: { enabled: true, readOnly: true }, analytics: {} },
      language: { default: language, translations: { [language]: {
        consentModal: { title: 'We use cookies', description: 'We use cookies to analyse traffic and improve the shop. You can accept all, reject them or manage preferences.', acceptAllBtn: 'Accept all', acceptNecessaryBtn: 'Reject all', showPreferencesBtn: 'Manage preferences' },
        preferencesModal: { title: 'x', acceptAllBtn: 'a', acceptNecessaryBtn: 'b', savePreferencesBtn: 'c', sections: [{ title: 'n', linkedCategory: 'necessary' }] },
      } } },
    }), lang);
    const banner = page.locator('#cc-main .cm');
    await expect(banner).toBeVisible();
    const box = (await banner.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(844 * 0.3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The primary action is not under the banner, and the page can scroll it further up.
    const login = (await page.locator('#login').boundingBox())!;
    expect(login.y + login.height).toBeLessThan(box.y);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  });
}
