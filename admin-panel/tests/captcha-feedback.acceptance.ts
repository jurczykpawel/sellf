/** An unfinished proof of work explains why a magic-link form cannot submit yet. */
import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { waitForEmail, extractMagicLink } from './helpers/mailpit';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

for (const [locale, messages] of [['pl', pl], ['en', en]] as const) {
  for (const partner of [false, true]) {
    test(`${locale} ${partner ? 'partner' : 'buyer'} login waits for ALTCHA and delivers a link`, async ({ page }) => {
      let release!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; });
      let started!: () => void;
      const challengeStarted = new Promise<void>(resolve => { started = resolve; });
      await page.route('**/api/captcha/challenge', async route => {
        started();
        await hold;
        await route.continue();
      });
      const errors: string[] = [];
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      let requests = 0;
      page.on('request', request => { if (request.url().endsWith('/api/auth/magic-link')) requests++; });
      const email = `captcha-${locale}-${partner}-${crypto.randomUUID()}@example.com`;
      try {
        await acceptAllCookies(page);
        await page.goto(`/${locale}/login${partner ? `?redirect_to=/${locale}/affiliates/apply` : ''}`);
        await page.locator('#email').fill(email);
        await page.locator('#terms-checkbox').press('Space');
        await expect(page.locator('#terms-checkbox')).toBeChecked();
        await challengeStarted;
        const button = page.locator('button[type=submit]');
        await expect(button).toBeDisabled();
        await expect(button).toContainText(messages.security.verifying);
        await page.screenshot({ path: test.info().outputPath('pending.png') });
        await button.click({ force: true });
        // Enter and native validation must not get stuck on ALTCHA's invisible checkbox.
        expect(await page.locator('form').evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(true);
        await page.locator('#email').press('Enter');
        expect(requests).toBe(0);
        release();
        await expect(button).toBeEnabled({ timeout: 30000 });
        await expect(button).toContainText(messages.auth.sendMagicLink);
        await button.click();
        await expect(page.getByText(messages.productView.checkEmailForMagicLink)).toBeVisible({ timeout: 30000 });
        const mail = await waitForEmail(email, { timeout: 20000 });
        expect(extractMagicLink(mail.HTML || mail.Text || '')).toBeTruthy();
        expect(requests).toBe(1);
        expect(errors.filter(error => /invalid form control|not focusable/i.test(error))).toEqual([]);
      } finally {
        release();
      }
    });
  }
}

for (const locale of ['pl', 'en']) {
  test(`${locale} free checkout explains pending verification`, async ({ page }) => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/captcha/challenge', async route => { await hold; await route.continue(); });
    try {
      await acceptAllCookies(page);
      await page.goto(`/${locale}/checkout/free-tutorial`);
      await page.locator('#email').fill('free-captcha@example.com');
      const terms = page.locator('#terms-checkbox');
      if (await terms.count()) await page.locator('#terms-checkbox').press('Space');
      const button = page.locator('button[type=submit]');
      await expect(button).toBeDisabled();
      await expect(button).toContainText(locale === 'pl' ? pl.security.verifying : en.security.verifying);
      release();
      await expect(button).toBeEnabled({ timeout: 30000 });
    } finally { release(); }
  });
}
